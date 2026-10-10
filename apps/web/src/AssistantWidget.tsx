import { useState } from 'react'
import './AssistantWidget.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000'

type ChatMessage = {
  role: 'user' | 'model'
  text: string
}

type PendingApplication = {
  confirmationRequired: boolean
  confirmationToken: string
  expiresInSeconds: number
  application: {
    name: string
    mobile: string
    netWeightGrams: number
    grossWeightGrams: number
    karat: number
    schemeId: string
  }
  schemeName: string
  eligibleLoanRupees: number
}

type ChatResponse = {
  reply: string
  pendingApplication?: PendingApplication | null
}

const money = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value)


function renderAssistantText(text: string) {
  const renderInline = (line: string, lineKey: string) =>
    line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((part, index) => {
      const key = `${lineKey}-${index}`;
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return <em key={key}>{part.slice(1, -1)}</em>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={key}>{part.slice(1, -1)}</code>;
      }
      return part;
    });

  return text.split("\n").map((line, index) => {
    const key = `line-${index}`;
    const trimmed = line.trim();
    if (!trimmed) return <br key={key} />;
    if (/^[-•]\s+/.test(trimmed)) {
      return <div className="tga-formatted-list-item" key={key}>• {renderInline(trimmed.replace(/^[-•]\s+/, ""), key)}</div>;
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const match = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
      if (match) {
        return <div className="tga-formatted-list-item" key={key}><strong>{match[1]}.</strong> {renderInline(match[2], key)}</div>;
      }
    }
    return <div key={key}>{renderInline(line, key)}</div>;
  });
}

export default function AssistantWidget() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'model',
      text: 'Hi! I’m the TGlobal loan assistant. I can explain loan plans, calculate an indicative quote, and help prepare an application.',
    },
  ])
  const [pending, setPending] = useState<PendingApplication | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<{ id: string; amount: number } | null>(null)

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = message.trim()
    if (!text || loading || confirming) return

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: 'user', text },
    ]

    setMessages(nextMessages)
    setMessage('')
    setPending(null)
    setSuccess(null)
    setError('')
    setLoading(true)

    try {
      const response = await fetch(`${API}/api/v1/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: nextMessages.slice(-12, -1),
        }),
      })

      const data = await response.json() as ChatResponse & {
        message?: string
      }

      if (!response.ok) {
        throw new Error(data.message || 'The assistant could not respond. Please try again.')
      }

      setMessages((current) => [
        ...current,
        { role: 'model', text: data.reply || 'I could not generate a response.' },
      ])

      if (data.pendingApplication?.confirmationToken) {
        setPending(data.pendingApplication)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach the assistant.')
    } finally {
      setLoading(false)
    }
  }

  async function confirmApplication() {
    if (!pending || confirming) return

    setConfirming(true)
    setError('')

    try {
      const response = await fetch(`${API}/api/v1/assistant/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmationToken: pending.confirmationToken,
          confirmed: true,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 409) {
          throw new Error(
            `A recent application already exists for this mobile number. Reference: ${data.existingApplicationId || 'available from support'}.`,
          )
        }

        if (response.status === 410) {
          setPending(null)
          throw new Error('Your confirmation has expired. Please prepare the application again.')
        }

        throw new Error(data.message || 'The application could not be submitted.')
      }

      const application = data.application
      setSuccess({
        id: application.id,
        amount: application.eligibleLoanRupees,
      })
      setPending(null)
      setMessages((current) => [
        ...current,
        {
          role: 'model',
          text: 'Your application has been submitted successfully. This is not a loan approval or guarantee of disbursement.',
        },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to confirm the application.')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="tga-widget">
      {open && (
        <section className="tga-panel" aria-label="TGlobal AI assistant">
          <header className="tga-header">
            <div className="tga-avatar">T</div>
            <div className="tga-heading">
              <strong>TGlobal Assistant</strong>
              <span><i /> AI-powered loan assistance</span>
            </div>
            <button
              className="tga-close"
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
            >
              ×
            </button>
          </header>

          <div className="tga-messages" aria-live="polite">
            {messages.map((item, index) => (
              <div
                key={`${index}-${item.role}`}
                className={`tga-message ${item.role === 'user' ? 'tga-user' : 'tga-model'}`}
              >
                {renderAssistantText(item.text)}
              </div>
            ))}

            {loading && <div className="tga-message tga-model">Thinking…</div>}

            {pending && !success && (
              <div className="tga-review">
                <div className="tga-review-label">REVIEW YOUR APPLICATION</div>
                <h3>{pending.application.name}</h3>
                <div className="tga-review-row">
                  <span>Mobile</span><strong>{pending.application.mobile}</strong>
                </div>
                <div className="tga-review-row">
                  <span>Gold</span>
                  <strong>
                    {pending.application.netWeightGrams}g net · {pending.application.grossWeightGrams}g gross
                  </strong>
                </div>
                <div className="tga-review-row">
                  <span>Purity</span><strong>{pending.application.karat}K</strong>
                </div>
                <div className="tga-review-row">
                  <span>Loan plan</span><strong>{pending.schemeName}</strong>
                </div>
                <div className="tga-review-amount">
                  <span>Indicative eligible amount</span>
                  <strong>{money(pending.eligibleLoanRupees)}</strong>
                </div>
                <p>This is an indicative estimate, not loan approval. Confirm only if the details are correct.</p>
                <button
                  type="button"
                  className="tga-confirm"
                  onClick={confirmApplication}
                  disabled={confirming || loading}
                >
                  {confirming ? 'Submitting…' : 'Confirm application'}
                </button>
                <button
                  type="button"
                  className="tga-edit"
                  onClick={() => {
                    setPending(null)
                    setError('')
                    setMessage('I want to change my application details.')
                  }}
                  disabled={confirming}
                >
                  Change details instead
                </button>
              </div>
            )}

            {success && (
              <div className="tga-success">
                <div className="tga-success-icon">✓</div>
                <strong>Application submitted</strong>
                <span>Reference: {success.id}</span>
                <b>{money(success.amount)}</b>
                <small>Indicative amount only. Approval is not guaranteed.</small>
              </div>
            )}

            {error && <div className="tga-error" role="alert">{error}</div>}
          </div>

          <form className="tga-composer" onSubmit={sendMessage}>
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask about plans or a gold quote…"
              aria-label="Message the assistant"
              maxLength={4000}
              disabled={loading || confirming}
            />
            <button type="submit" disabled={loading || confirming || !message.trim()}>
              ↑
            </button>
          </form>
          <div className="tga-disclaimer">Indicative estimates only · No loan approval guarantees</div>
        </section>
      )}

      {!open && <button
        type="button"
        className="tga-launcher"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? 'Close TGlobal assistant' : 'Open TGlobal assistant'}
      >
        {open ? '×' : '✳'}
        <span>Ask TGlobal AI</span>
      </button>}
    </div>
  )
}
