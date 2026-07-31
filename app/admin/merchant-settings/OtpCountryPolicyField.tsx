"use client";

import { useMemo, useState } from "react";
import type { OtpCountryDefinition } from "../../../services/settings/otp-country-catalog";

type OtpCountryPolicyFieldProps = {
  countries: readonly OtpCountryDefinition[];
  initialAllowedCountryCodes: string[];
  initialDefaultCountryCode: string;
};

export default function OtpCountryPolicyField({
  countries,
  initialAllowedCountryCodes,
  initialDefaultCountryCode,
}: OtpCountryPolicyFieldProps) {
  const catalogByCode = useMemo(
    () => new Map(countries.map((country) => [country.iso2, country])),
    [countries],
  );
  const initialCodes = [...new Set(initialAllowedCountryCodes.map((code) => code.toUpperCase()))];
  const safeInitialCodes = initialCodes.length ? initialCodes : ["IN"];
  const safeInitialDefault = safeInitialCodes.includes(initialDefaultCountryCode.toUpperCase())
    ? initialDefaultCountryCode.toUpperCase()
    : safeInitialCodes[0];
  const [selectedCodes, setSelectedCodes] = useState(safeInitialCodes);
  const [defaultCode, setDefaultCode] = useState(safeInitialDefault);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const unknownCodes = selectedCodes.filter((code) => !catalogByCode.has(code));

  function setCountrySelected(code: string, selected: boolean) {
    if (!selected && selectedCodes.length === 1) return;
    const next = selected
      ? [...selectedCodes, code]
      : selectedCodes.filter((selectedCode) => selectedCode !== code);
    setSelectedCodes(next);
    if (!next.includes(defaultCode)) setDefaultCode(next[0]);
  }

  function selectAll() {
    setSelectedCodes([...new Set([...selectedCodes, ...countries.map((country) => country.iso2)])]);
  }

  function keepOnlyDefault() {
    setSelectedCodes([defaultCode]);
  }

  function countryLabel(code: string) {
    const country = catalogByCode.get(code);
    return country ? `${country.flag} ${country.name} (${country.dialCode})` : `⚠ ${code} — Unsupported catalog entry`;
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="mk-field flex-1" htmlFor="otp-country-search">
          <span className="mk-label">Search countries</span>
          <input
            id="otp-country-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Country name, ISO code, or dial code"
            className="mk-input"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={selectAll} className="mk-btn mk-btn-sm">
            Select all
          </button>
          <button type="button" onClick={keepOnlyDefault} disabled={selectedCodes.length === 1} className="mk-btn mk-btn-sm">
            Keep only default
          </button>
        </div>
      </div>

      <p className="text-sm font-medium text-gray-700" aria-live="polite">
        {selectedCodes.length} {selectedCodes.length === 1 ? "country" : "countries"} selected
      </p>

      <fieldset className="max-h-[400px] overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-2">
        <legend className="sr-only">Allowed OTP login countries</legend>
        {countries.map((country) => {
          const matches = !normalizedQuery || `${country.name} ${country.iso2} ${country.dialCode}`.toLowerCase().includes(normalizedQuery);
          const checked = selectedCodes.includes(country.iso2);
          return (
            <label key={country.iso2} className={`${matches ? "flex" : "hidden"} cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-800 hover:bg-white focus-within:ring-2 focus-within:ring-gray-900/20`}>
              <input
                type="checkbox"
                name="otpAllowedCountryCodes"
                value={country.iso2}
                checked={checked}
                aria-disabled={checked && selectedCodes.length === 1}
                onChange={(event) => setCountrySelected(country.iso2, event.target.checked)}
                className="size-4 rounded"
                style={{ accentColor: "var(--primary)" }}
              />
              <span className="text-lg" aria-hidden="true">{country.flag}</span>
              <span className="min-w-0 flex-1 font-medium">{country.name}</span>
              <span className="text-gray-500">{country.dialCode}</span>
              <span className="font-mono text-xs text-gray-400">{country.iso2}</span>
            </label>
          );
        })}
        {normalizedQuery && !countries.some((country) => `${country.name} ${country.iso2} ${country.dialCode}`.toLowerCase().includes(normalizedQuery)) ? (
          <p className="p-4 text-sm text-gray-500">No catalog countries match your search.</p>
        ) : null}
      </fieldset>

      {unknownCodes.length ? (
        <fieldset className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <legend className="px-1 text-sm font-semibold text-amber-900">Unknown/unsupported catalog entries</legend>
          <p className="mb-2 text-xs leading-5 text-amber-800">These saved codes are preserved unless you remove them.</p>
          {unknownCodes.map((code) => (
            <label key={code} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-amber-950 focus-within:ring-2 focus-within:ring-amber-700/30">
              <input type="checkbox" name="otpAllowedCountryCodes" value={code} checked aria-disabled={selectedCodes.length === 1} onChange={() => setCountrySelected(code, false)} className="size-4 rounded border-amber-400 focus:ring-amber-700" />
              <span>⚠ {code} — Saved country code not available in the current catalog</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <label className="mk-field">
        <span className="mk-label">Default country</span>
        <select name="otpDefaultCountryCode" value={defaultCode} onChange={(event) => setDefaultCode(event.target.value)} className="mk-select">
          {selectedCodes.map((code) => <option key={code} value={code}>{countryLabel(code)}</option>)}
        </select>
        <span className="mk-help">The default must be one of the selected countries.</span>
      </label>
    </div>
  );
}
