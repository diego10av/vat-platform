import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('@/lib/ecdf', () => ({
  computeECDF: vi.fn(),
}));

import { queryOne } from '@/lib/db';
import { computeECDF } from '@/lib/ecdf';
import {
  buildECDFXml,
  getFormCode,
  periodToECDF,
  esc,
} from '@/lib/ecdf-xml';

const mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockComputeECDF = computeECDF as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQueryOne.mockReset();
  mockComputeECDF.mockReset();
});

describe('getFormCode', () => {
  it('simplified regime always returns TVA001N', () => {
    expect(getFormCode('simplified', 'Y1')).toBe('TVA001N');
    expect(getFormCode('simplified', 'Q1')).toBe('TVA001N');
    expect(getFormCode('simplified', '03')).toBe('TVA001N');
  });

  it('ordinary + annual → TVA002NA', () => {
    expect(getFormCode('ordinary', 'Y1')).toBe('TVA002NA');
  });

  it('ordinary + quarterly → TVA002NT', () => {
    expect(getFormCode('ordinary', 'Q1')).toBe('TVA002NT');
    expect(getFormCode('ordinary', 'Q4')).toBe('TVA002NT');
  });

  it('ordinary + monthly → TVA002NM', () => {
    expect(getFormCode('ordinary', '01')).toBe('TVA002NM');
    expect(getFormCode('ordinary', '12')).toBe('TVA002NM');
    expect(getFormCode('ordinary', '7')).toBe('TVA002NM');
  });
});

describe('periodToECDF', () => {
  it('formats annual as just the year', () => {
    expect(periodToECDF('Y1', 2026)).toBe('2026');
  });

  it('formats quarterly with year-Qn', () => {
    expect(periodToECDF('Q1', 2026)).toBe('2026-Q1');
    expect(periodToECDF('q3', 2026)).toBe('2026-Q3'); // uppercased
  });

  it('zero-pads monthly periods to two digits', () => {
    expect(periodToECDF('3', 2026)).toBe('2026-03');
    expect(periodToECDF('12', 2026)).toBe('2026-12');
    expect(periodToECDF('01', 2026)).toBe('2026-01');
  });

  it('falls back to year-period for unknown shapes', () => {
    expect(periodToECDF('WEIRD', 2026)).toBe('2026-WEIRD');
  });
});

describe('esc', () => {
  it('escapes XML metacharacters', () => {
    expect(esc('Tom & Jerry')).toBe('Tom &amp; Jerry');
    expect(esc('<script>')).toBe('&lt;script&gt;');
    expect(esc('"quoted"')).toBe('&quot;quoted&quot;');
    expect(esc("it's")).toBe('it&apos;s');
  });

  it('escapes ampersand BEFORE other entities (no double-encoding)', () => {
    expect(esc('<&>')).toBe('&lt;&amp;&gt;');
  });

  it('coerces non-strings', () => {
    expect(esc(42 as unknown as string)).toBe('42');
    expect(esc(null as unknown as string)).toBe('null');
  });
});

describe('buildECDFXml', () => {
  it('throws when declaration is missing', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(buildECDFXml('d-missing')).rejects.toThrow(/not found/i);
  });

  it('throws when matricule is missing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Q1', matricule: null, vat_number: 'LU1', entity_name: 'X', rcs_number: null,
    });
    await expect(buildECDFXml('d-1')).rejects.toThrow(/matricule/i);
  });

  it('builds well-formed XML with the right form code and period encoding', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Q1', matricule: '20232456346',
      vat_number: 'LU12345678', entity_name: 'Test SARL', rcs_number: 'B123456',
    });
    mockComputeECDF.mockResolvedValueOnce({
      regime: 'ordinary',
      boxes: [
        { box: '012', section: 'A', value: 1000, computation: 'sum', label: 'Ventes' },
        { box: '076', section: 'F', value: 170,  computation: 'formula', label: 'TVA due' },
      ],
    });

    const { xml, filename } = await buildECDFXml('d-1');
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<FormType>TVA002NT</FormType>'); // ordinary + quarterly
    expect(xml).toContain('<Period>2026-Q1</Period>');
    expect(xml).toContain('<Year>2026</Year>');
    expect(xml).toContain('<Matricule>20232456346</Matricule>');
    expect(xml).toContain('<VATNumber>LU12345678</VATNumber>');
    expect(xml).toContain('<Name>Test SARL</Name>');
    expect(xml).toContain('<RCS>B123456</RCS>');
    expect(xml).toMatch(/<NumericField id="012" section="A">1000\.00<\/NumericField>/);
    expect(xml).toMatch(/<NumericField id="076" section="F">170\.00<\/NumericField>/);
    expect(filename).toBe('eCDF_TVA002NT_Test_SARL_2026_Q1.xml');
  });

  it('omits RCS element when not set', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Y1', matricule: '1', vat_number: '', entity_name: 'X', rcs_number: null,
    });
    mockComputeECDF.mockResolvedValueOnce({ regime: 'simplified', boxes: [] });
    const { xml } = await buildECDFXml('d-1');
    expect(xml).not.toContain('<RCS>');
  });

  it('sanitises special chars in entity name', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Y1', matricule: '1', vat_number: '',
      entity_name: 'Tom & Jerry <Inc>', rcs_number: null,
    });
    mockComputeECDF.mockResolvedValueOnce({ regime: 'simplified', boxes: [] });
    const { xml, filename } = await buildECDFXml('d-1');
    expect(xml).toContain('<Name>Tom &amp; Jerry &lt;Inc&gt;</Name>');
    // Filename stripped of unsafe chars (runs of bad chars collapse to _)
    expect(filename).toMatch(/^eCDF_TVA001N_Tom_Jerry_Inc_+2026_Y1\.xml$/);
    expect(filename).not.toContain('&');
    expect(filename).not.toContain('<');
    expect(filename).not.toContain(' ');
  });

  it('emits every box even when value is zero (AED rejects partial filings)', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Y1', matricule: '1', vat_number: '', entity_name: 'X', rcs_number: null,
    });
    mockComputeECDF.mockResolvedValueOnce({
      regime: 'simplified',
      boxes: [
        { box: '012', section: 'A', value: 0, computation: 'sum', label: 'x' },
        { box: '076', section: 'F', value: 0, computation: 'formula', label: 'x' },
      ],
    });
    const { xml } = await buildECDFXml('d-1');
    expect(xml).toMatch(/id="012" section="A">0\.00<\/NumericField>/);
    expect(xml).toMatch(/id="076" section="F">0\.00<\/NumericField>/);
  });
});
