import { describe, it, expect } from 'vitest';
import { selectedPriceForFinance, type SelectedPrice } from '../to-finance';
import { buildInitialInput } from '../../finance/from-db';
import { DEFAULT_TAX_RATES } from '../../finance/tax-config';

const price: SelectedPrice = { unitPriceMinor: 10000n, specMatch:'MATCH', quote:{ currency:'USD', fxRate:500,
  pricesIncludeVat:false, verification:'VERIFIED', validUntil:null, documentId:'source-doc' } };
describe('selected supplier price to finance',()=>{
  it('converts foreign currency and preserves exclusive VAT',()=>{
    expect(selectedPriceForFinance(price)).toEqual({unitCostMinor:5_000_000,verified:true,vatMode:'EXCLUSIVE'});
  });
  it('does not admit unknown FX, expired or unverified suppliers',()=>{
    for(const candidate of [
      {...price,quote:{...price.quote,fxRate:null}},
      {...price,quote:{...price.quote,validUntil:new Date('2000-01-01')}},
      {...price,quote:{...price.quote,verification:'UNVERIFIED'}},
      {...price,specMatch:'UNKNOWN'},
    ]) expect(selectedPriceForFinance(candidate).unitCostMinor).toBeNull();
  });
  it('preserves missing positions instead of silently dropping their cost',()=>{
    const input=buildInitialInput({regime:'GENERAL_VAT',isVatPayer:true,startPriceMinor:null,rates:DEFAULT_TAX_RATES,
      lineItems:[{name:'Missing quote',quantity:2,unitCostMinor:null,unit:'шт',verified:false}]});
    expect(input.costs.unpricedItems).toEqual(['Missing quote']); expect(input.costs.items).toEqual([]);
  });
});
