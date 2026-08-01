// These thresholds and colors mirror RNGdle's public rarity palette.
// Badge rarity is score-based and remains deterministic when /api/home omits it.
export const RARITY_ORDER = ["trash", "common", "uncommon", "rare", "epic", "anomaly", "mythic"];

export const RARITY_LABELS = {
  trash: "Trash",
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  anomaly: "Anomaly",
  mythic: "Mythic",
  unknown: "Rarity unavailable",
};

export const RARITY_PALETTE = {
  trash: { bg: "#fffbeb", gradient: "linear-gradient(135deg,#fffbeb,#fff7ed)", border: "#d97706", text: "#92400e", accent: "#c8a87c" },
  common: { bg: "#f9fafb", gradient: "linear-gradient(135deg,#f3f4f6,#ffffff)", border: "#9ca3af", text: "#4b5563", accent: "#d1d5db" },
  uncommon: { bg: "#ecfdf5", gradient: "linear-gradient(135deg,#d1fae5,#f0fdf4)", border: "#10b981", text: "#047857", accent: "#6ee7b7" },
  rare: { bg: "#eff6ff", gradient: "linear-gradient(135deg,#dbeafe,#f0f9ff)", border: "#3b82f6", text: "#1d4ed8", accent: "#93c5fd" },
  epic: { bg: "#f5f3ff", gradient: "linear-gradient(135deg,#ede9fe,#fdf4ff)", border: "#8b5cf6", text: "#6d28d9", accent: "#c4b5fd" },
  anomaly: { bg: "#fff7ed", gradient: "linear-gradient(135deg,#fed7aa,#fffbeb)", border: "#f97316", text: "#c2410c", accent: "#fdba74" },
  mythic: { bg: "#fff1f2", gradient: "linear-gradient(135deg,#ffe4e6,#faf5ff 52%,#cffafe)", border: "#db2777", text: "#b91c1c", accent: "#f9a8d4" },
  unknown: { bg: "#f9fafb", gradient: "linear-gradient(135deg,#f3f4f6,#ffffff)", border: "#d1d5db", text: "#6b7280", accent: "#d1d5db" },
};

const BADGE_THRESHOLDS = [
  [1_000, "common"],
  [10_000, "uncommon"],
  [100_000, "rare"],
  [1_000_000, "epic"],
  [10_000_000, "anomaly"],
];

// The public game maps total-score percentiles to these card tiers. These
// score cutoffs are the first score at each published percentile boundary.
const CARD_THRESHOLDS = [
  [2_098, "trash"],
  [5_761, "common"],
  [9_644, "uncommon"],
  [23_077, "rare"],
  [35_744, "epic"],
  [164_953, "anomaly"],
];

export function normalizeRarity(value) {
  const rarity = String(value ?? "").trim().toLowerCase();
  return RARITY_ORDER.includes(rarity) ? rarity : "unknown";
}

export function badgeRarity(score) {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore) || numericScore < 0) return "unknown";
  return BADGE_THRESHOLDS.find(([threshold]) => numericScore < threshold)?.[1] ?? "mythic";
}

export function cardRarity(score) {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore) || numericScore < 0) return "unknown";
  return CARD_THRESHOLDS.find(([threshold]) => numericScore < threshold)?.[1] ?? "mythic";
}

export function rarityLabel(value) {
  return RARITY_LABELS[normalizeRarity(value)];
}

export function rarityPalette(value) {
  return RARITY_PALETTE[normalizeRarity(value)];
}
