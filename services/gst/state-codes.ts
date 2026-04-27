const GST_STATE_CODE_TO_NAMES: Record<string, string[]> = {
  "01": ["jammu and kashmir", "jammu & kashmir", "jk"],
  "02": ["himachal pradesh", "hp"],
  "03": ["punjab", "pb"],
  "04": ["chandigarh", "ch"],
  "05": ["uttarakhand", "uk", "ua"],
  "06": ["haryana", "hr"],
  "07": ["delhi", "new delhi", "dl", "nct of delhi", "national capital territory of delhi"],
  "08": ["rajasthan", "rj"],
  "09": ["uttar pradesh", "up"],
  "10": ["bihar", "br"],
  "11": ["sikkim", "sk"],
  "12": ["arunachal pradesh", "ar"],
  "13": ["nagaland", "nl"],
  "14": ["manipur", "mn"],
  "15": ["mizoram", "mz"],
  "16": ["tripura", "tr"],
  "17": ["meghalaya", "ml"],
  "18": ["assam", "as"],
  "19": ["west bengal", "wb"],
  "20": ["jharkhand", "jh"],
  "21": ["odisha", "or", "od"],
  "22": ["chhattisgarh", "ct", "cg"],
  "23": ["madhya pradesh", "mp"],
  "24": ["gujarat", "gj"],
  "25": ["daman and diu", "dd", "daman & diu"],
  "26": ["dadra and nagar haveli and daman and diu", "dnhdd", "dn"],
  "27": ["maharashtra", "mh"],
  "29": ["karnataka", "ka"],
  "30": ["goa", "ga"],
  "31": ["lakshadweep", "ld"],
  "32": ["kerala", "kl"],
  "33": ["tamil nadu", "tn"],
  "34": ["puducherry", "pondicherry", "py"],
  "35": ["andaman and nicobar islands", "an", "andaman & nicobar islands"],
  "36": ["telangana", "ts", "tg"],
  "37": ["andhra pradesh", "ap"],
  "38": ["ladakh", "la"],
  "97": ["other territory"],
  "99": ["centre jurisdiction", "central jurisdiction"],
};

const GST_STATE_CODES = new Set(Object.keys(GST_STATE_CODE_TO_NAMES));

const GST_STATE_NAME_INDEX = new Map<string, string>();

for (const [code, names] of Object.entries(GST_STATE_CODE_TO_NAMES)) {
  for (const name of names) {
    GST_STATE_NAME_INDEX.set(normalizeStateInput(name), code);
  }
}

function normalizeStateInput(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[.\-_/]/g, " ")
    .replace(/\s+/g, " ");
}

export function resolveGstStateCode(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const paddedNumeric = raw.match(/^\d{1,2}$/) ? raw.padStart(2, "0") : raw;
  if (GST_STATE_CODES.has(paddedNumeric)) {
    return paddedNumeric;
  }

  return GST_STATE_NAME_INDEX.get(normalizeStateInput(raw)) || null;
}

export function isKnownGstStateCode(value: string | null | undefined): boolean {
  return GST_STATE_CODES.has(String(value ?? "").trim());
}

export function getGstStatePrimaryNameByCode(value: string | null | undefined): string | null {
  const code = resolveGstStateCode(value);
  if (!code) return null;
  const names = GST_STATE_CODE_TO_NAMES[code];
  const primary = names?.[0];
  if (!primary) return null;
  return primary.replace(/\b\w/g, (char) => char.toUpperCase());
}
