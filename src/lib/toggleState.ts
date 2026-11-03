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

/**
 * Is this enum a genuine two-state FLAG (draw it as an on/off button), or a two-option SELECTOR
 * (draw it as a dropdown)?
 *
 * Two options is not the same thing as on/off. `CONTROLLERS_TEMPOTOUSE` is `PRESET | GLOBAL` and
 * `CONTROLLERS_PITCH_SOURCE` is `INPUT 1 | INPUT 2` — both two options, neither a flag. Drawing them
 * as toggles made them permanently green: `enumIsOn` reads any label that is not an OFF word as "on",
 * so both states looked identical and a press appeared to do nothing (measured on the FM3 2026-11-03 —
 * the write landed, the button never changed).
 *
 * The rule: a flag has an OFF word on one side (ON/OFF, ENGAGED/BYPASS, RUN/MUTE). A pair with no OFF
 * word is a selector unless its labels carry no words at all (a bare 0/1 or symbol pair), which keeps
 * the old index-based behaviour for numeric flags.
 */
export function isOnOffEnum(e: EnumLike | undefined | null): boolean {
  if (!e?.options || e.options.length !== 2) return false;
  const labels = e.options.map((o) => (o.label ?? '').trim());
  if (labels.some((l) => OFF_WORDS.test(l))) return true;
  return labels.every((l) => !/[a-z]/i.test(l));
}
