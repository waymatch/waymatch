export default function ErrorBanner({ message, className = '' }) {
  return <div role="alert" className={`rounded-xl bg-danger/10 text-danger text-sm px-3.5 py-2.5 ${className}`}>{message}</div>;
}
