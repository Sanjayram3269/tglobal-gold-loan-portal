import { useEffect, useMemo, useState } from 'react'
import './App.css'
import AssistantWidget from './AssistantWidget'

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000'

type Scheme = {
  id: string
  name: string
  interestRatePercent: string
  maxLtv: string
  tenureMonths: number
  repaymentType: 'BULLET' | 'EMI'
}

type Quote = {
  schemeId: string
  schemeName: string
  pureGoldGrams: string
  goldRatePerGramRupees: number
  goldValueRupees: number
  ltvPercent: number
  eligibleLoanRupees: number
  interestRatePercent: string
  tenureMonths: number
  repaymentType: 'BULLET' | 'EMI'
}

type Application = {
  id: string
  mobile: string
  eligibleLoanRupees: number
  status: string
  createdAt?: string
}

type Lead = {
  id: string
  name: string
  mobile: string
  netWeightGrams: number
  grossWeightGrams: number
  karat: number
  schemeId: string
  eligibleLoanRupees: number
  status: string
  createdAt: string
}

const money = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value)

function App() {
  const [schemes, setSchemes] = useState<Scheme[]>([])
  const [schemeId, setSchemeId] = useState('PLAN_EMI_01')
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [net, setNet] = useState('45')
  const [gross, setGross] = useState('50')
  const [karat, setKarat] = useState('22')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [application, setApplication] = useState<Application | null>(null)
  const [step, setStep] = useState(1)
  const [loadingSchemes, setLoadingSchemes] = useState(true)
  const [quoting, setQuoting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [leads, setLeads] = useState<Lead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(true)
  const [leadsError, setLeadsError] = useState('')
  const [leadPlanFilter, setLeadPlanFilter] = useState('ALL')
  const [showAdmin, setShowAdmin] = useState(false)

  useEffect(() => {
    fetch(`${API}/api/v1/loan-schemes`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load loan plans.')
        return response.json()
      })
      .then((data) => {
        const plans = Array.isArray(data) ? data : data.schemes ?? data.data ?? []
        setSchemes(plans)
        if (plans.length && !plans.some((p: Scheme) => p.id === schemeId)) {
          setSchemeId(plans[0].id)
        }
      })
      .catch(() => setError('Unable to connect to the loan service. Check that the API is running on port 4000.'))
      .finally(() => setLoadingSchemes(false))
  }, [])

  useEffect(() => {
    if (!showAdmin) return
    let active = true
    setLeadsLoading(true)
    setLeadsError('')
    fetch(`${API}/api/v1/leads`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load applications.')
        return response.json()
      })
      .then((data) => {
        if (active) setLeads(Array.isArray(data.leads) ? data.leads : [])
      })
      .catch(() => {
        if (active) setLeadsError('Could not load applications. Check that the API is running.')
      })
      .finally(() => {
        if (active) setLeadsLoading(false)
      })
    return () => { active = false }
  }, [showAdmin])

  useEffect(() => {
    if (!net || !gross || !karat || !schemeId) {
      setQuote(null)
      return
    }

    const timer = window.setTimeout(async () => {
      setQuoting(true)
      try {
        const response = await fetch(`${API}/api/v1/quotes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            netWeightGrams: Number(net),
            grossWeightGrams: Number(gross),
            karat: Number(karat),
            schemeId,
          }),
        })
        const data = await response.json()
        if (!response.ok) {
          setQuote(null)
          return
        }
        setQuote(data.quote ?? data)
      } catch {
        setQuote(null)
      } finally {
        setQuoting(false)
      }
    }, 300)

    return () => window.clearTimeout(timer)
  }, [net, gross, karat, schemeId])

  const selectedScheme = useMemo(
    () => schemes.find((scheme) => scheme.id === schemeId),
    [schemes, schemeId],
  )

  function validateDetails() {
    const errors: Record<string, string> = {}
    if (!/^[A-Za-z ]{2,60}$/.test(name.trim())) {
      errors.name = 'Enter a name using 2–60 letters and spaces.'
    }
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      errors.mobile = 'Enter a valid 10-digit Indian mobile number.'
    }
    if (!net || !gross || Number(net) <= 0 || Number(gross) <= 0 ||
        Number(net) > 1000 || Number(gross) > 1000) {
      errors.weight = 'Weights must be greater than 0 and at most 1,000 g.'
    } else if (Number(net) > Number(gross)) {
      errors.weight = 'Net gold weight cannot exceed gross weight.'
    }
    if (!quote) errors.quote = 'Wait for a valid quote before continuing.'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function submitApplication() {
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`${API}/api/v1/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          mobile,
          netWeightGrams: Number(net),
          grossWeightGrams: Number(gross),
          karat: Number(karat),
          schemeId,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        if (response.status === 409) {
          setError(`An application already exists. Reference: ${data.existingApplicationId ?? 'Please contact support.'}`)
        } else {
          setError(data.message ?? 'We could not submit your application. Please try again.')
        }
        return
      }
      setApplication(data.application)
      setStep(3)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function startOver() {
    setApplication(null)
    setStep(1)
    setName('')
    setMobile('')
    setError('')
    setFieldErrors({})
  }

  return (
    <div className="app-shell">
      <div className="announcement">
        <span className="announcement-dot" />
        Transparent gold valuation. A simpler way to borrow.
      </div>

      <header className="site-header">
        <a className="brand" href="#" aria-label="TGlobal home">
          <span className="brand-mark">T</span>
          <span>TGLOBAL<span className="brand-sub">GOLD LOANS</span></span>
        </a>
        <nav className="header-nav">
          <a href="#how-it-works">How it works</a>
          <a href="#loan-plans">Loan plans</a>
          <a href="#applications" onClick={() => setShowAdmin(true)}>Applications</a>
          <a className="header-cta" href="#apply">Get a quote <span>↗</span></a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span /> GOLD LOANS, MADE CLEAR</div>
            <h1>Your gold.<br />Your goals.<br /><em>Your next move.</em></h1>
            <p className="hero-description">
              Unlock the value of your gold with a transparent estimate,
              flexible repayment options and a straightforward application.
            </p>
            <div className="hero-actions">
              <a href="#apply" className="primary-button">Calculate my loan <span>↗</span></a>
              <a href="#how-it-works" className="text-button">See how it works <span>↓</span></a>
            </div>
            <div className="trust-row">
              <div className="trust-icon">✓</div>
              <div><strong>Know your estimate upfront</strong><span>Clear numbers before you apply</span></div>
              <div className="trust-divider" />
              <div className="trust-icon">⌁</div>
              <div><strong>Simple by design</strong><span>A guided digital experience</span></div>
            </div>
          </div>
          <div className="hero-art">
            <div className="hero-image" role="img" aria-label="Gold jewellery on a warm neutral background">
              <div className="image-overlay" />
              <div className="image-label"><span>01 / YOUR GOLD</span><strong>Value in every gram.</strong></div>
            </div>
            <div className="floating-card">
              <div className="floating-card-top"><span className="gold-mini">✳</span><span>GOLD RATE / GRAM</span><span className="live-dot" /></div>
              <strong>₹7,000</strong>
              <small>Illustrative 24K reference rate</small>
            </div>
            <div className="hero-index">PRECISION · TRANSPARENCY · TRUST</div>
          </div>
          <div className="hero-bottom-line"><span>BUILT AROUND YOU</span><span>SCROLL TO EXPLORE ↓</span></div>
        </section>

        <section id="apply" className="application-section">
          <div className="section-heading">
            <div className="eyebrow"><span /> YOUR ESTIMATE STARTS HERE</div>
            <h2>A little gold.<br /><em>A lot of possibility.</em></h2>
            <p>Enter a few details to see an indicative loan amount. No commitment required.</p>
          </div>

          <div className="application-layout">
            <div className="form-card">
              <div className="form-topline">
                <span>GOLD LOAN ESTIMATOR</span>
                <span>STEP 0{step} / 03</span>
              </div>
              <div className="step-track"><span className={step >= 1 ? 'active' : ''} /><span className={step >= 2 ? 'active' : ''} /><span className={step >= 3 ? 'active' : ''} /></div>

              {step === 1 && (
                <>
                  <div className="form-heading"><span className="step-number">01</span><div><h3>Tell us about your gold</h3><p>We'll calculate an indicative value.</p></div></div>
                  <div className="field-grid">
                    <label className="field full-field">Loan plan
                      <select id="loan-plan" value={schemeId} onChange={(e) => setSchemeId(e.target.value)} disabled={loadingSchemes}>
                        {schemes.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name} · {scheme.interestRatePercent}% p.a.</option>)}
                      </select>
                    </label>
                    <label className="field">Net gold weight (g)
                      <input type="number" min="0.01" max="1000" step="0.01" value={net} onChange={(e) => setNet(e.target.value)} placeholder="e.g. 45" />
                    </label>
                    <label className="field">Gross jewellery weight (g)
                      <input type="number" min="0.01" max="1000" step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="e.g. 50" />
                    </label>
                    <label className="field full-field">Gold purity
                      <div className="karat-options">
                        {['18', '22', '24'].map((value) => (
                          <button type="button" key={value} className={karat === value ? 'karat-option selected' : 'karat-option'} onClick={() => setKarat(value)}>
                            <strong>{value}K</strong><span>{value === '18' ? '75% gold' : value === '22' ? '91.6% gold' : '99.9% gold'}</span>
                          </button>
                        ))}
                      </div>
                    </label>
                  </div>
                  {fieldErrors.weight && <p className="field-error">{fieldErrors.weight}</p>}
                  {fieldErrors.quote && <p className="field-error">{fieldErrors.quote}</p>}
                  <div className="form-note"><span>ⓘ</span> This estimate uses a mock reference gold rate and is not a final offer.</div>
                  <button className="primary-button full-button" onClick={() => { if (quote && Number(net) <= Number(gross) && Number(net) > 0) { setFieldErrors({}); setStep(2) } else { setFieldErrors({ weight: Number(net) > Number(gross) ? 'Net gold weight cannot exceed gross weight.' : 'Enter valid weights and wait for your quote.' }) } }}>
                    Continue to your details <span>→</span>
                  </button>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="form-heading"><span className="step-number">02</span><div><h3>Where should we reach you?</h3><p>Your details help us create your application.</p></div></div>
                  <div className="field-grid">
                    <label className="field full-field">Full name
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your full name" autoComplete="name" />
                      {fieldErrors.name && <small className="field-error">{fieldErrors.name}</small>}
                    </label>
                    <label className="field full-field">Mobile number
                      <div className="mobile-input"><span>🇮🇳 +91</span><input value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile number" inputMode="numeric" autoComplete="tel-national" /></div>
                      {fieldErrors.mobile && <small className="field-error">{fieldErrors.mobile}</small>}
                    </label>
                  </div>
                  <div className="form-note"><span>🔒</span> Your mobile number is masked in the application list.</div>
                  <div className="button-row">
                    <button className="secondary-button" onClick={() => { setStep(1); setError('') }}>← Back</button>
                    <button className="primary-button continue-button" onClick={() => { if (validateDetails()) { setError(''); setStep(3) } }}>Review application <span>→</span></button>
                  </div>
                </>
              )}

              {step === 3 && !application && (
                <>
                  <div className="form-heading"><span className="step-number">03</span><div><h3>Review before submitting</h3><p>Please check the details below.</p></div></div>
                  <div className="review-list">
                    <div><span>Applicant</span><strong>{name}</strong></div>
                    <div><span>Mobile</span><strong>+91 {mobile}</strong></div>
                    <div><span>Gold</span><strong>{net}g net · {gross}g gross · {karat}K</strong></div>
                    <div><span>Loan plan</span><strong>{selectedScheme?.name}</strong></div>
                    <div><span>Indicative amount</span><strong>{quote ? money(quote.eligibleLoanRupees) : '—'}</strong></div>
                  </div>
                  <p className="disclaimer">By submitting, you confirm that these details are accurate. This is an application, not a loan approval or guarantee of disbursement.</p>
                  <div className="button-row">
                    <button className="secondary-button" onClick={() => setStep(2)}>← Edit details</button>
                    <button className="primary-button continue-button" onClick={submitApplication} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit application'} <span>→</span></button>
                  </div>
                </>
              )}

              {application && (
                <div className="success-state">
                  <div className="success-icon">✓</div>
                  <div className="eyebrow"><span /> APPLICATION RECEIVED</div>
                  <h3>You're one step<br />closer.</h3>
                  <p>Your application has been recorded. This does not mean your loan has been approved.</p>
                  <div className="application-reference"><span>APPLICATION REFERENCE</span><strong>{application.id}</strong></div>
                  <div className="success-amount"><span>Indicative loan amount</span><strong>{money(application.eligibleLoanRupees ?? quote?.eligibleLoanRupees ?? 0)}</strong></div>
                  <button className="secondary-button full-button" onClick={startOver}>Start a new estimate ↗</button>
                </div>
              )}
              {error && <div className="error-banner" role="alert">{error}</div>}
            </div>

            <aside className="quote-card">
              <div className="quote-card-head"><span className="quote-icon">✳</span><span>YOUR LIVE ESTIMATE</span><span className="live-badge"><i /> LIVE</span></div>
              <p className="quote-caption">Indicative eligible loan amount</p>
              <div className="quote-amount">{quoting ? 'Calculating…' : quote ? money(quote.eligibleLoanRupees) : '—'}</div>
              <div className="quote-divider" />
              <div className="quote-detail"><span>Pure gold content</span><strong>{quote ? `${quote.pureGoldGrams} g` : '—'}</strong></div>
              <div className="quote-detail"><span>Reference gold rate</span><strong>{quote ? `${money(quote.goldRatePerGramRupees)}/g` : '—'}</strong></div>
              <div className="quote-detail"><span>Gold value</span><strong>{quote ? money(quote.goldValueRupees) : '—'}</strong></div>
              <div className="quote-detail"><span>Loan-to-value</span><strong>{quote ? `${quote.ltvPercent}%` : '—'}</strong></div>
              <div className="quote-divider" />
              <div className="quote-plan"><div><span>SELECTED PLAN</span><strong>{selectedScheme?.name ?? 'Loading plans…'}</strong></div><div className="plan-rate">{selectedScheme?.interestRatePercent ?? '—'}<small>% p.a.</small></div></div>
              <p className="quote-footnote">Illustrative estimate only. Final valuation and eligibility are subject to lender assessment, applicable terms and verification.</p>
              <div className="secure-line"><span>♧</span> A transparent estimate, with no commitment.</div>
            </aside>
          </div>
        </section>

        <section id="how-it-works" className="steps-section">
          <div className="eyebrow"><span /> SIMPLE FROM START TO FINISH</div>
          <h2>Three steps.<br /><em>One clearer path.</em></h2>
          <div className="steps-grid">
            <article><span className="step-index">01 / DETAILS</span><div className="step-visual">◈</div><h3>Tell us about your gold</h3><p>Enter your gold's weight and purity to get an indicative valuation.</p></article>
            <article><span className="step-index">02 / ESTIMATE</span><div className="step-visual">₹</div><h3>Explore your options</h3><p>Compare available repayment plans and see your estimated loan amount.</p></article>
            <article><span className="step-index">03 / APPLY</span><div className="step-visual">↗</div><h3>Submit your application</h3><p>Review your details and submit them for the next stage of the process.</p></article>
          </div>
        </section>

        <section id="loan-plans" className="plans-section">
          <div><div className="eyebrow"><span /> MADE TO FIT YOUR NEEDS</div><h2>Choose your<br /><em>way forward.</em></h2></div>
          <p className="plans-intro">Different plans for different priorities. Choose the repayment structure that works for you.</p>
          <div className="plans-grid">
            {schemes.map((scheme, index) => (
              <article className={schemeId === scheme.id ? 'plan-card plan-selected' : 'plan-card'} key={scheme.id}>
                <span className="plan-number">0{index + 1} / {scheme.repaymentType === 'EMI' ? 'STEADY PAYMENTS' : 'PAY AT MATURITY'}</span>
                <h3>{scheme.name}</h3>
                <div className="plan-interest">{scheme.interestRatePercent}<small>% p.a.</small></div>
                <p>{scheme.repaymentType === 'EMI' ? 'Equal monthly instalments across the tenure.' : 'Principal and applicable interest payable at maturity.'}</p>
                <div className="plan-meta"><span>Tenure</span><strong>{scheme.tenureMonths} months</strong></div>
                <div className="plan-meta"><span>Maximum LTV</span><strong>{Number(scheme.maxLtv) * 100}%</strong></div>
                <button className={schemeId === scheme.id ? 'plan-button active' : 'plan-button'} onClick={() => { setSchemeId(scheme.id); document.querySelector('#apply')?.scrollIntoView({ behavior: 'smooth' }) }}>
                  {schemeId === scheme.id ? 'Selected plan ✓' : 'Calculate with this plan →'}
                </button>
              </article>
            ))}
            {!schemes.length && !loadingSchemes && <p className="plans-intro">Loan plans are temporarily unavailable. Please try again shortly.</p>}
          </div>
        </section>


        {showAdmin && <section id="applications" className="admin-section">
          <div className="admin-heading">
            <div>
              <div className="eyebrow"><span /> DEMO ADMIN VIEW</div>
              <h2>Application <em>dashboard.</em></h2>
              <p>Recently submitted applications, newest first. Mobile numbers are masked.</p>
            </div>
            <div className="admin-controls">
              <label htmlFor="lead-plan-filter">Filter by plan</label>
              <select id="lead-plan-filter" value={leadPlanFilter} onChange={(event) => setLeadPlanFilter(event.target.value)}>
                <option value="ALL">All plans</option>
                {schemes.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}
              </select>
              <button type="button" className="secondary-button" onClick={() => setShowAdmin(false)}>Close</button>
              <button type="button" className="secondary-button" onClick={() => {
                setLeadsLoading(true)
                setLeadsError('')
                fetch(`${API}/api/v1/leads`)
                  .then(async (response) => {
                    if (!response.ok) throw new Error('Unable to load applications.')
                    return response.json()
                  })
                  .then((data) => setLeads(Array.isArray(data.leads) ? data.leads : []))
                  .catch(() => setLeadsError('Could not load applications. Please retry.'))
                  .finally(() => setLeadsLoading(false))
              }}>Refresh</button>
            </div>
          </div>
          {leadsError && <p className="admin-feedback" role="alert">{leadsError}</p>}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Applicant</th><th>Mobile</th><th>Gold</th><th>Plan</th><th>Eligible amount</th><th>Status</th><th>Submitted</th></tr></thead>
              <tbody>
                {leadsLoading ? (
                  <tr><td colSpan={7}>Loading applications…</td></tr>
                ) : leads.filter((lead) => leadPlanFilter === 'ALL' || lead.schemeId === leadPlanFilter).length === 0 ? (
                  <tr><td colSpan={7}>No applications match this filter.</td></tr>
                ) : leads.filter((lead) => leadPlanFilter === 'ALL' || lead.schemeId === leadPlanFilter).map((lead) => (
                  <tr key={lead.id}>
                    <td><strong>{lead.name}</strong><small>{lead.id}</small></td>
                    <td>{lead.mobile}</td>
                    <td>{lead.netWeightGrams}g net · {lead.grossWeightGrams}g gross · {lead.karat}K</td>
                    <td>{schemes.find((scheme) => scheme.id === lead.schemeId)?.name ?? lead.schemeId}</td>
                    <td>{money(lead.eligibleLoanRupees)}</td>
                    <td><span className="admin-status">{lead.status}</span></td>
                    <td>{new Date(lead.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="admin-note">Demonstration dashboard only. Authentication and role-based access must be added before production use.</p>
        </section>}

        <section className="closing-cta">
          <div><div className="eyebrow"><span /> YOUR NEXT CHAPTER STARTS HERE</div><h2>Let your gold<br /><em>move you forward.</em></h2></div>
          <a className="primary-button" href="#apply">Get your estimate <span>↗</span></a>
          <div className="closing-watermark">T</div>
        </section>
      </main>

      <AssistantWidget />

      <footer className="site-footer">
        <a className="brand footer-brand" href="#"><span className="brand-mark">T</span><span>TGLOBAL<span className="brand-sub">GOLD LOANS</span></span></a>
        <p>Clear estimates. Informed decisions.</p>
        <a href="#applications" onClick={() => setShowAdmin(true)}>Demo applications</a>
        <span>© {new Date().getFullYear()} TGlobal · Demo experience</span>
      </footer>
    </div>
  )
}

export default App
