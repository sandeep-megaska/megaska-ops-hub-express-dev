export const REVERSE_PICKUP_FEE_PAISE = 12000;
export const REVERSE_PICKUP_CURRENCY = "INR";
// Default number of days after delivery in which a customer may raise an
// exchange OR an issue request. Merchants can override this per shop
// (LoopDesk settings → requests.windowDays); this is the fallback default.
export const EXCHANGE_ALLOWED_DAYS_WINDOW = 5;
// Guardrails for the merchant-configurable value.
export const REQUEST_WINDOW_DAYS_MIN = 1;
export const REQUEST_WINDOW_DAYS_MAX = 30;
export const REVERSE_PICKUP_ALLOWED_DAYS_WINDOW = 7;
export const REVERSE_PICKUP_PAYMENT_EXPIRY_DAYS = 2;

export const EXCLUDED_CATEGORY_KEYWORDS = [
  "bra",
  "sports bra",
  "yoga bra",
  "saree shapewear",
  "saree shapewears",
  "bikini",
  "swim bottom",
  "swim bottoms",
  "swim cap",
  "swim caps",
];

export const CLEARANCE_KEYWORDS = ["clearance", "final sale", "last chance"];
