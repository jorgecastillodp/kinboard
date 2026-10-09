/**
 * The Location field's place search (OpenStreetMap's Nominatim) and how a
 * result reads. Both follow the family's settings and never a built-in
 * country or language: the search covers the family's holiday country when one
 * is set and the whole world when none is, names come back in the app's
 * language, and an address is written the way its own country writes it.
 */

/** The part of Nominatim's `address` the short form uses. */
export interface PlaceAddress {
  road?: string;
  house_number?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country?: string;
  /** ISO 3166-1 alpha-2, lower case: "us". */
  country_code?: string;
  /** ISO 3166-2 of the state or province: "US-IL". */
  "ISO3166-2-lvl4"?: string;
}

export interface LocationSearchOptions {
  query: string;
  limit: number;
  /** ISO 3166-1 alpha-2 in either case. Omitted, empty or not two letters: the whole world is searched. */
  countryCode?: string | null;
  /** The app's language (`en`, `de`, `fr`, ...): the names in the results come back in it. */
  language: string;
}

const COUNTRY_CODE = /^[A-Za-z]{2}$/;

/** What Nominatim is asked for. */
export function locationSearchParams({ query, limit, countryCode, language }: LocationSearchOptions): URLSearchParams {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    addressdetails: "1",
    limit: String(limit),
    "accept-language": language || "en",
  });
  if (countryCode && COUNTRY_CODE.test(countryCode)) params.set("countrycodes", countryCode.toLowerCase());
  return params;
}

interface AddressStyle {
  /** "123 Main Street" rather than "Hauptstraße 5". */
  numberFirst: boolean;
  /** Before the city ("20095 Hamburg") or after it ("London SW1A 2AA"). */
  postcode: "before" | "after";
  /** The state or province code between the city and the postcode: "Springfield, IL 62701". */
  stateCode: boolean;
}

/** How most of Europe writes it, and what a result with no known country gets. */
const DEFAULT_STYLE: AddressStyle = { numberFirst: false, postcode: "before", stateCode: false };

const NORTH_AMERICAN_STYLE: AddressStyle = { numberFirst: true, postcode: "after", stateCode: true };
const BRITISH_STYLE: AddressStyle = { numberFirst: true, postcode: "after", stateCode: false };

const STYLES: Readonly<Record<string, AddressStyle>> = {
  us: NORTH_AMERICAN_STYLE,
  ca: NORTH_AMERICAN_STYLE,
  au: NORTH_AMERICAN_STYLE,
  gb: BRITISH_STYLE,
  ie: BRITISH_STYLE,
  nz: BRITISH_STYLE,
  fr: { numberFirst: true, postcode: "before", stateCode: false },
};

/** "US-IL" is "CA"; nothing when the result has no state or province. */
function stateCodeOf(address: PlaceAddress): string | null {
  const code = address["ISO3166-2-lvl4"]?.split("-")[1];
  return code && /^[A-Z0-9]{1,3}$/.test(code) ? code : null;
}

/**
 * A result as one short line, the way the place's own country writes it:
 * "Hauptstraße 5, 20095 Hamburg", "5 Rue de Rivoli, 75001 Paris",
 * "123 Main Street, Springfield, IL 62701", "10 Downing Street, London SW1A 2AA".
 * A result with no street or town is written as OpenStreetMap's own full name.
 */
export function formatPlace(address: PlaceAddress | undefined, displayName: string): string {
  if (!address) return displayName;
  const style = STYLES[address.country_code?.toLowerCase() ?? ""] ?? DEFAULT_STYLE;
  const parts: string[] = [];

  if (address.road) {
    const number = address.house_number;
    parts.push(number ? (style.numberFirst ? `${number} ${address.road}` : `${address.road} ${number}`) : address.road);
  }

  const city = address.city || address.town || address.village || address.municipality;
  if (city) {
    const postcode = address.postcode;
    if (style.postcode === "before") {
      parts.push(postcode ? `${postcode} ${city}` : city);
    } else {
      const state = style.stateCode ? stateCodeOf(address) : null;
      const town = state ? `${city}, ${state}` : city;
      parts.push(postcode ? `${town} ${postcode}` : town);
    }
  }

  return parts.length > 0 ? parts.join(", ") : displayName;
}
