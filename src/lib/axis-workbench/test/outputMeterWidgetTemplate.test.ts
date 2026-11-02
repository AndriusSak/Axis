import { describe, expect, it } from 'vitest';
import {
  AXIS_OUTPUT_METER_LIBRARY_MARKER,
  createAxisWorkbenchDefaultDocument,
  ensureAxisOutputMeterWidgetTemplate
} from '../axisWorkbenchDefaults';

const ENTRY = 'axis.library.widget.outputMeter';

/** A document minted BEFORE the Output Level template existed: no entry, no marker. */
function legacyDoc() {
  const doc = createAxisWorkbenchDefaultDocument();
  delete doc.widgetLibrary[ENTRY];
  delete doc.metadata?.[AXIS_OUTPUT_METER_LIBRARY_MARKER];
  return doc;
}

describe('ensureAxisOutputMeterWidgetTemplate', () => {
  it('adds the Output Level template to a persisted document that predates it', () => {
    const doc = legacyDoc();
    ensureAxisOutputMeterWidgetTemplate(doc);
    const template = doc.widgetLibrary[ENTRY];
    expect(template).toBeTruthy();
    expect(template.title).toBe('Output Level');
    const widgets = Object.values(template.widgets);
    expect(widgets).toHaveLength(1);
    expect(widgets[0].type).toBe('axis.outputMeter');
    expect(doc.metadata?.[AXIS_OUTPUT_METER_LIBRARY_MARKER]).toBe('v1');
  });

  it('is idempotent and never overwrites an edited template', () => {
    const doc = legacyDoc();
    ensureAxisOutputMeterWidgetTemplate(doc);
    doc.widgetLibrary[ENTRY].title = 'My Meter';
    const before = JSON.stringify(doc.widgetLibrary[ENTRY]);
    ensureAxisOutputMeterWidgetTemplate(doc);
    expect(JSON.stringify(doc.widgetLibrary[ENTRY])).toBe(before);
  });

  it('respects a deliberate delete: the marker stops the entry coming back', () => {
    const doc = createAxisWorkbenchDefaultDocument();
    ensureAxisOutputMeterWidgetTemplate(doc);
    delete doc.widgetLibrary[ENTRY];
    ensureAxisOutputMeterWidgetTemplate(doc);
    expect(doc.widgetLibrary[ENTRY]).toBeUndefined();
  });
});
