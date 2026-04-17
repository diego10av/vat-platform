import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
}));

import { queryOne, query } from '@/lib/db';
import { buildAppendix } from '@/lib/excel';

const mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockQuery = query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockQueryOne.mockReset();
  mockQuery.mockReset();
});

describe('buildAppendix', () => {
  it('throws when declaration missing', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(buildAppendix('d-missing')).rejects.toThrow(/not found/i);
  });

  it('builds an xlsx with the expected filename', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Q1', regime: 'simplified', status: 'review',
      entity_name: 'Test SARL', vat_number: 'LU12345678', matricule: '20232456346',
      address: '1 Rue du Test',
    });
    mockQuery.mockResolvedValueOnce([
      {
        sort_order: 1, provider: 'Supplier A', country: 'LU',
        description: 'Services', invoice_date: '2026-01-15',
        invoice_number: 'INV-001', amount_eur: '100.00',
        vat_rate: '17', vat_applied: '17', rc_amount: '0', amount_incl: '117',
        currency: 'EUR', currency_amount: null, ecb_rate: null,
        treatment: 'LUX_17', direction: 'incoming',
      },
    ]);

    const { buffer, filename } = await buildAppendix('d-1');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(100);
    expect(filename).toBe('VAT_Appendix_Test_SARL_2026_Q1.xlsx');
  });

  it('produces a valid xlsx that can be parsed back', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Y1', regime: 'ordinary', status: 'review',
      entity_name: 'ReadBack Co', vat_number: 'LU99', matricule: '1', address: null,
    });
    mockQuery.mockResolvedValueOnce([
      {
        sort_order: 1, provider: 'SupplierOne', country: 'LU',
        description: 'Consulting', invoice_date: '2026-03-01',
        invoice_number: 'INV-01', amount_eur: '500.00',
        vat_rate: '17', vat_applied: '85', rc_amount: '0', amount_incl: '585',
        currency: null, currency_amount: null, ecb_rate: null,
        treatment: 'LUX_17', direction: 'incoming',
      },
    ]);

    const { buffer } = await buildAppendix('d-1');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('VAT Appendix');
    expect(sheet).toBeDefined();

    // Header cells
    expect(sheet!.getCell('A1').value).toBe('VAT Declaration Appendix');
    expect(sheet!.getCell('B3').value).toBe('ReadBack Co');
    expect(sheet!.getCell('B4').value).toBe('LU99');
    expect(sheet!.getCell('E3').value).toBe('2026 — Y1');
    expect(sheet!.getCell('E4').value).toBe('ordinary');
  });

  it('emits only Section A when there are no outgoing lines', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Y1', regime: 'simplified', status: 'review',
      entity_name: 'A-only', vat_number: '', matricule: '', address: null,
    });
    mockQuery.mockResolvedValueOnce([
      {
        sort_order: 1, provider: 'P1', country: 'LU',
        description: 'x', invoice_date: '2026-01-01',
        invoice_number: 'x', amount_eur: '1',
        vat_rate: '17', vat_applied: '0.17', rc_amount: '0', amount_incl: '1.17',
        currency: null, currency_amount: null, ecb_rate: null,
        treatment: 'LUX_17', direction: 'incoming',
      },
    ]);

    const { buffer } = await buildAppendix('d-1');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('VAT Appendix')!;

    // Scan the first column for the section titles — section B must not appear.
    const titles: string[] = [];
    sheet.eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === 'string') titles.push(v);
    });
    expect(titles.some(t => t.startsWith('A.'))).toBe(true);
    expect(titles.some(t => t.startsWith('B.'))).toBe(false);
  });

  it('sanitises entity name in the filename', async () => {
    mockQueryOne.mockResolvedValueOnce({
      year: 2026, period: 'Y1', regime: 'simplified', status: 'review',
      entity_name: 'Acme & Co / SARL', vat_number: '', matricule: '', address: null,
    });
    mockQuery.mockResolvedValueOnce([]);

    const { filename } = await buildAppendix('d-1');
    expect(filename).not.toContain('&');
    expect(filename).not.toContain('/');
    expect(filename).not.toContain(' ');
    expect(filename.endsWith('.xlsx')).toBe(true);
  });
});
