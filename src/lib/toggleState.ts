/**
 * Is a two-state enum "on"?
 *
 * The FM3 serves some flags with the ON option FIRST — `GLOBAL_PWRAMPBYP` ("Power Amp Modeling") and
 * `GLOBAL_CABINETBYP` ("Cabinet Modeling") are bypass flags whose value 0 means the modelling is
 * running. A fixed `value === options[1].value` test therefore read every one of those as OFF and drew
 * the pill grey while the amp/cab were live, which is the "greyed out but actually active" report.
 *
 * The LABEL decides whenever the enum carries words; the index is only a fallback for enums whose
 * options are numbers or bare symbols.
 */

/** Option words that mean "nothing is engaged". */
const OFF_WORDS = /^(off|no|none|false|bypass(ed)?|disable(d)?|mute(d)?|inactive|hidden|-|–)$/i;

export type EnumLike = {
  value: number | null | undefined;
  options?: { value: number; label?: string | null }[] | null;
};

export function enumIsOn(e: EnumLike | undefined | null): boolean {
  if (!e || !e.options || e.options.length === 0) return false;
  const current = e.options.find((o) => o.value === e.value);
  const label = (current?.label ?? '').trim();
  if (/[a-z]/i.test(label)) return !OFF_WORDS.test(label);
  return e.value === (e.options[1]?.value ?? 1);
}
