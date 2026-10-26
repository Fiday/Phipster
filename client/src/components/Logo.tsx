export function Logo({ large = false }: { large?: boolean }) {
  return <div className={`logo ${large ? "logo--large" : ""}`}>phipster<span>♪</span></div>;
}
