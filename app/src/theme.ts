// Design tokens from the approved Sentivo design (light theme only).
export const C = {
  canvas: '#F4F7FB',
  card: '#FFFFFF',
  card2: '#F2F5FA',
  ink: '#0F1720',
  muted: '#6C7A89',
  line: '#E7ECF3',
  emerald: '#10B981',
  slate: '#64748B',
  red: '#EF4444',
  amber: '#F59E0B',
  blue: '#3B82F6',
  violet: '#8B5CF6',
  dark: '#0E141B',
};

// soft translucent tints for icon tiles
export const tint = (hex: string, a = 0.12) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
