const { test, expect } = require('@playwright/test');

const goodResponse = {
  source: '고용노동부 고용24',
  items: [{
    company: '광양정비',
    title: '설비 정비원',
    region: '전남 광양',
    career: '경력무관',
    regDt: '20261001',
    closeDt: '20991231',
    url: 'https://example.com/job'
  }]
};

async function mockResponses(page, responses) {
  let requestCount = 0;
  await page.route('**/.netlify/functions/work24-jobs*', async route => {
    const response = responses[Math.min(requestCount, responses.length - 1)];
    requestCount += 1;
    await route.fulfill({
      status: response.status || 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(response.body)
    });
  });
  return () => requestCount;
}

test('legacy Work24 button opens the results screen and displays returned jobs', async ({ page }) => {
  await mockResponses(page, [{ body: goodResponse }]);
  await page.goto('/');
  await page.evaluate(() => go('jobDetail'));

  await expect(page.locator('#jobDetail')).toHaveClass(/active/);
  const legacyButton = page.locator('#jobDetail button').filter({ hasText: '실제 공고 불러오기' });
  await expect(legacyButton).toBeVisible();
  await legacyButton.click();

  await expect(page.locator('#liveJobs')).toHaveClass(/active/);
  await expect(page.locator('#liveJobStatus')).toContainText('고용24 실제 데이터');
  await expect(page.locator('#liveJobResults')).toContainText('설비 정비원');
});

test('live jobs button retries a failed request and then displays results', async ({ page }) => {
  const requestCount = await mockResponses(page, [
    { status: 502, body: { message: '고용24 연결 오류' } },
    { body: goodResponse }
  ]);
  await page.goto('/');
  await page.evaluate(() => go('liveJobs'));

  await page.getByRole('button', { name: '공고 조회' }).click();
  await expect(page.locator('#liveJobStatus')).toContainText('고용24 연결 오류');
  await page.getByRole('button', { name: '다시 시도' }).click();

  await expect(page.locator('#liveJobResults')).toContainText('설비 정비원');
  expect(requestCount()).toBe(2);
});
