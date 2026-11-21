/**
 * Initials in a tinted circle. Hue is hashed from the name, so a company gets
 * the same colour on every card without anyone maintaining a logo set.
 */
export function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const hue = hueOf(name);
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: `hsl(${hue} 55% 88%)`,
        color: `hsl(${hue} 55% 28%)`,
      }}
    >
      {initials(name)}
    </span>
  );
}
