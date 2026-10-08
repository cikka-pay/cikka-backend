import { describe, it, expect } from 'vitest';
import { HubbleRestClient } from '../../src/services/hubble-rest.service';

describe('Hubble Money REST API Client', () => {
  it('should authenticate and obtain bearer access token', async () => {
    const token = await HubbleRestClient.getAccessToken();
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
  });

  it('should fetch live brand coupons catalog from Hubble REST API', async () => {
    const result = await HubbleRestClient.getBrands({ limit: 3 });
    expect(result).toBeDefined();
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.source).toBe('hubble_api');
    expect(result.isLiveApi).toBe(true);
  });

  it('should fetch single brand detail by product ID from live REST API', async () => {
    const brands = await HubbleRestClient.getBrands({ limit: 1 });
    const firstBrand = brands.data[0];
    expect(firstBrand).toBeDefined();

    const detail = await HubbleRestClient.getBrandById(firstBrand.id);
    expect(detail.data).toBeDefined();
    expect(detail.data?.id).toBe(firstBrand.id);
    expect(detail.source).toBe('hubble_api');
  });

  it('should fetch partner wallet balance', async () => {
    const wallet = await HubbleRestClient.getWallet();
    expect(wallet).toBeDefined();
    expect(wallet.currency).toBe('INR');
    expect(typeof wallet.balance).toBe('number');
  });
});
