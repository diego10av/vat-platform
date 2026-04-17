import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
}));

vi.mock('@/lib/ecdf', () => ({
  computeECDF: vi.fn(),
}));

import { queryOne } from '@/lib/db';
import { computeECDF } from '@/lib/ecdf';
import { buildFrontPagePDF } from '@/lib/front-page-pdf';

const mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockComputeECDF = computeECDF as unknown as ReturnType<typeof vi.fn>;

// Canonical fake ECDF report so each test doesn't need to re-type it.
const fakeEcdf = (overrides: Partial<{
  payable: number; credit: number; vat_due: number; boxes: unknown[];
}> = {}) => ({
  regime: 'simplified',
  year: 2026,
  period: 'Q1',
  form_version: '1.0',
  boxes: overrides.boxes ?? [
    { box: '012', section: 'A', value: 1000, computation: 'sum', label: 'Amount A' },
    { box: '076', section: 'F', value: 170, computation: 'formula', label: 'VAT due' },
  ],
  box_values: {},
  totals: {
    payable: overrides.payable ?? 170,
    credit: overrides.credit ?? 0,
    vat_due: overrides.vat_due ?? 170,
  },
  manual_boxes_pending: [],
  warnings: [],
});

beforeEach(() => {
  mockQueryOne.mockReset();
  mockComputeECDF.mockReset();
});

describe('buildFrontPagePDF', () => {
  it('throws when declaration missing', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(buildFrontPagePDF('d-missing')).rejects.toThrow(/not found/i);
  });

  it('returns a Buffer + filename of the expected shape', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Q1', entity_name: 'Test SARL',
      vat_number: 'LU1', matricule: '20232456346', rcs_number: null,
      address: '1 Rue X', client_name: null, regime: 'simplified',
    });
    mockComputeECDF.mockResolvedValueOnce(fakeEcdf());

    const { buffer, filename } = await buildFrontPagePDF('d-1');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
    expect(filename).toBe('VAT_FrontPage_Test_SARL_2026_Q1.pdf');
    // PDF files start with "%PDF-"
    expect(buffer.toString('ascii', 0, 5)).toBe('%PDF-');
  });

  it('produces a valid PDF that pdf-lib can read back', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Y1', entity_name: 'ReadBack',
      vat_number: 'LU9', matricule: '1', rcs_number: 'B1',
      address: null, client_name: null, regime: 'ordinary',
    });
    mockComputeECDF.mockResolvedValueOnce(fakeEcdf());

    const { buffer } = await buildFrontPagePDF('d-1');
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2); // cover + annex 1
    const pages = doc.getPages();
    expect(pages[0]!.getSize().width).toBeCloseTo(595.28, 1);
    expect(pages[0]!.getSize().height).toBeCloseTo(841.89, 1);
    expect(doc.getTitle()).toContain('ReadBack');
  });

  it('includes a payment annex page when payable > 0', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Q2', entity_name: 'WithPayment',
      vat_number: 'LU1', matricule: '20232456346', rcs_number: null,
      address: null, client_name: null, regime: 'simplified',
    });
    mockComputeECDF.mockResolvedValueOnce(fakeEcdf({ payable: 500 }));

    const { buffer } = await buildFrontPagePDF('d-1');
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3); // cover + annex 1 + payment annex
  });

  it('omits the payment annex when payable is zero', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Q3', entity_name: 'NoPayment',
      vat_number: 'LU1', matricule: '20232456346', rcs_number: null,
      address: null, client_name: null, regime: 'simplified',
    });
    mockComputeECDF.mockResolvedValueOnce(fakeEcdf({ payable: 0 }));

    const { buffer } = await buildFrontPagePDF('d-1');
    const doc = await PDFDocument.load(buffer);
    // Just cover + annex 1, no annex 2
    expect(doc.getPageCount()).toBe(2);
  });

  it('omits the payment annex when matricule is missing (ref generation fails)', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Q4', entity_name: 'NoMatricule',
      vat_number: 'LU1', matricule: null, rcs_number: null,
      address: null, client_name: null, regime: 'simplified',
    });
    mockComputeECDF.mockResolvedValueOnce(fakeEcdf({ payable: 500 }));

    const { buffer } = await buildFrontPagePDF('d-1');
    const doc = await PDFDocument.load(buffer);
    // Payment annex skipped because payment ref generation threw
    expect(doc.getPageCount()).toBe(2);
  });

  it('sanitises special chars in the filename', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Y1', entity_name: 'Acme & Co / SARL',
      vat_number: 'LU1', matricule: '1', rcs_number: null,
      address: null, client_name: null, regime: 'simplified',
    });
    mockComputeECDF.mockResolvedValueOnce(fakeEcdf({ payable: 0 }));

    const { filename } = await buildFrontPagePDF('d-1');
    expect(filename).not.toContain('&');
    expect(filename).not.toContain('/');
    expect(filename).not.toContain(' ');
    expect(filename.endsWith('.pdf')).toBe(true);
  });
});
