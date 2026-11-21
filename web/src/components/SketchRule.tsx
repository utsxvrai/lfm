/** Hairline divider. Kept as a component so every existing call site restyles at once. */
export function SketchRule({ className = "" }: { className?: string }) {
  return <hr className={`rule ${className}`} aria-hidden="true" />;
}
