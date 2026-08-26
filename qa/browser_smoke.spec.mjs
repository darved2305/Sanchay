import { createRequire } from 'node:module';

const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM || import.meta.url);
const { test, expect } = require('playwright/test');

const screenshots = '/private/tmp/sanchaya-browser-artifacts';

function collectDiagnostics(page) {
  const consoleErrors = [];
  const failedRequests = [];
  const badResponses = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(`pageerror: ${error.stack || error.message}`);
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'failed'}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return { consoleErrors, failedRequests, badResponses };
}

test('landing page renders and routes to authentication', async ({ page }) => {
  const diagnostics = collectDiagnostics(page);
  await page.goto('/');
  await expect(page.getByText('Sanchaya').first()).toBeVisible();
  await page.screenshot({ path: `${screenshots}/landing.png`, fullPage: true });

  const loginLink = page.getByRole('link', { name: /sign in|login|get started/i }).first();
  await expect(loginLink).toBeVisible();
  await loginLink.click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  await page.screenshot({ path: `${screenshots}/login.png`, fullPage: true });

  expect(diagnostics.consoleErrors, diagnostics.consoleErrors.join('\n')).toEqual([]);
  expect(diagnostics.failedRequests, diagnostics.failedRequests.join('\n')).toEqual([]);
});

test('login form exposes validation and registration controls', async ({ page }) => {
  const diagnostics = collectDiagnostics(page);
  await page.goto('/login');

  await page.getByRole('button', { name: /sign in/i }).last().click();
  await expect(await page.locator('#signin-email').evaluate((element) => !element.validity.valid)).toBe(true);
  await expect(await page.locator('#signin-password').evaluate((element) => !element.validity.valid)).toBe(true);

  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('heading', { name: /join sanchaya/i })).toBeVisible();
  await expect(page.getByLabel('Full Name')).toBeVisible();
  await expect(page.getByLabel('Institutional Email')).toBeVisible();
  await expect(page.locator('#reg-institution')).toBeVisible();
  await expect(page.locator('#reg-dept')).toBeVisible();
  await page.screenshot({ path: `${screenshots}/register.png`, fullPage: true });

  expect(diagnostics.consoleErrors, diagnostics.consoleErrors.join('\n')).toEqual([]);
  expect(diagnostics.failedRequests, diagnostics.failedRequests.join('\n')).toEqual([]);
});

test('seed faculty can authenticate through the real login form', async ({ page }) => {
  const email = process.env.QA_FACULTY_EMAIL;
  const password = process.env.QA_FACULTY_PASSWORD;
  test.skip(!email || !password, 'Set QA_FACULTY_EMAIL and QA_FACULTY_PASSWORD for the live auth flow.');

  const diagnostics = collectDiagnostics(page);
  await page.goto('/login');
  await page.locator('#signin-email').fill(email);
  await page.locator('#signin-password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).last().click();
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /^good (morning|afternoon|evening),/i })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${screenshots}/faculty-dashboard.png`, fullPage: true });

  expect(diagnostics.consoleErrors, diagnostics.consoleErrors.join('\n')).toEqual([]);
  expect(diagnostics.failedRequests, diagnostics.failedRequests.join('\n')).toEqual([]);
});

test('faculty can click through the compulsory record, evidence, profile and appraisal pages', async ({ page }) => {
  const email = process.env.QA_FACULTY_EMAIL;
  const password = process.env.QA_FACULTY_PASSWORD;
  test.skip(!email || !password, 'Set QA_FACULTY_EMAIL and QA_FACULTY_PASSWORD for the live faculty pages flow.');

  const diagnostics = collectDiagnostics(page);
  await page.goto('/login');
  await page.locator('#signin-email').fill(email);
  await page.locator('#signin-password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).last().click();
  await expect(page.getByRole('heading', { name: /^good (morning|afternoon|evening),/i })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /activities (&|and|\/) record/i }).click();
  await expect(page.getByRole('heading', { name: /activities & submissions/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${screenshots}/activities.png`, fullPage: true });
  await page.getByRole('button', { name: /add activity/i }).last().click();
  await expect(page.getByRole('heading', { name: /log new activity/i })).toBeVisible();
  await expect(page.locator('#activity-title')).toBeVisible();
  await page.getByRole('button', { name: /cancel/i }).click();

  await page.getByRole('button', { name: 'Evidence Library', exact: true }).click();
  await expect(page.getByRole('heading', { name: /evidence & proof library/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/returned by the API|No evidence stored yet/).first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${screenshots}/evidence.png`, fullPage: true });

  await page.getByRole('button', { name: /my profile/i }).click();
  await expect(page.getByRole('heading', { name: /faculty profile/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /save profile/i })).toBeVisible();
  await page.screenshot({ path: `${screenshots}/profile.png`, fullPage: true });

  await page.getByRole('button', { name: /self-appraisal/i }).click();
  await expect(page.getByRole('heading', { name: /self-appraisal/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/confirmed activities are available for generation\.|confirmed activities in this draft\./)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /generate draft/i })).toBeEnabled();
  await page.screenshot({ path: `${screenshots}/appraisal.png`, fullPage: true });

  expect(diagnostics.consoleErrors, diagnostics.consoleErrors.join('\n')).toEqual([]);
  expect(diagnostics.failedRequests, diagnostics.failedRequests.join('\n')).toEqual([]);
});

test('seed admin can open the institution console and use server-side controls', async ({ page }) => {
  const email = process.env.QA_ADMIN_EMAIL;
  const password = process.env.QA_ADMIN_PASSWORD;
  test.skip(!email || !password, 'Set QA_ADMIN_EMAIL and QA_ADMIN_PASSWORD for the live admin flow.');

  const diagnostics = collectDiagnostics(page);
  await page.goto('/login');
  await page.locator('#signin-email').fill(email);
  await page.locator('#signin-password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).last().click();
  await expect(page.getByRole('heading', { name: /institution admin console/i })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole('heading', { name: /faculty directory/i })).toBeVisible({ timeout: 20_000 });
  try {
    await expect(page.getByText('FAC001', { exact: true })).toBeVisible({ timeout: 20_000 });
  } catch (error) {
    error.message += `\nBrowser diagnostics:\n${diagnostics.consoleErrors.join('\n')}\nBad responses:\n${diagnostics.badResponses.join('\n')}`;
    throw error;
  }

  const search = page.getByPlaceholder(/search name, email, or employee code/i);
  await search.fill('FAC001');
  await expect(page.getByText('FAC001', { exact: true })).toBeVisible({ timeout: 20_000 });
  const selects = page.locator('select');
  await expect(selects).toHaveCount(6);
  await selects.nth(3).selectOption('employee_code');
  await selects.nth(4).selectOption('desc');
  await page.getByRole('button', { name: /refresh data/i }).click();
  await page.screenshot({ path: `${screenshots}/admin-console.png`, fullPage: true });

  const adminDiagnosticsMessage = [
    ...diagnostics.consoleErrors,
    ...diagnostics.failedRequests,
    ...diagnostics.badResponses,
  ].join('\n');
  expect(diagnostics.consoleErrors, adminDiagnosticsMessage).toEqual([]);
  expect(diagnostics.failedRequests, adminDiagnosticsMessage).toEqual([]);
  expect(diagnostics.badResponses, adminDiagnosticsMessage).toEqual([]);
});

test('faculty registration creates a real account or confirmation request', async ({ page }) => {
  const email = process.env.QA_NEW_USER_EMAIL;
  const password = process.env.QA_NEW_USER_PASSWORD;
  test.skip(!email || !password, 'Set QA_NEW_USER_EMAIL and QA_NEW_USER_PASSWORD for the registration and CRUD flow.');

  await page.goto('/register');
  await page.locator('#reg-name').fill('Browser QA Faculty');
  await page.locator('#reg-email').fill(email);
  await page.locator('#reg-institution').fill('Vidyanagar Institute of Technology');
  await page.locator('#reg-code').fill(`QA-${Date.now()}`);
  await page.locator('#reg-dept').fill('Computer Science');
  await page.locator('#reg-password').fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: /create faculty account/i }).click();
  const confirmationNotice = page.getByText(/account created\. check your email/i);
  const confirmedSession = page.getByRole('heading', { name: /^good (morning|afternoon|evening),/i });
  await expect(confirmationNotice.or(confirmedSession)).toBeVisible({ timeout: 30_000 });
  if (await confirmationNotice.isVisible().catch(() => false)) return;
});

test('confirmed new faculty can persist an activity across reload', async ({ page }) => {
  const email = process.env.QA_NEW_USER_EMAIL;
  const password = process.env.QA_NEW_USER_PASSWORD;
  test.skip(!email || !password, 'Set QA_NEW_USER_EMAIL and QA_NEW_USER_PASSWORD for the registration and CRUD flow.');

  const diagnostics = collectDiagnostics(page);
  const title = `Browser QA activity ${Date.now()}`;
  await page.goto('/login');
  await page.locator('#signin-email').fill(email);
  await page.locator('#signin-password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).last().click();
  await expect(page.getByRole('heading', { name: /^good (morning|afternoon|evening),/i })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /activities (&|and|\/) record/i }).click();
  await expect(page.getByRole('heading', { name: /activities & submissions/i })).toBeVisible({ timeout: 20_000 });
  if (process.env.QA_NEW_USER_EXPECT_EMPTY === '1') await expect(page.getByText(/0 loaded/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /add activity/i }).last().click();
  await page.locator('#activity-title').fill(title);
  await page.locator('#activity-category').selectOption('teaching');
  await page.locator('#activity-start').fill('2026-08-12');
  await page.locator('#activity-year').fill('2025-26');
  await page.locator('#activity-description').fill('Created during the real browser persistence check.');
  await page.getByRole('button', { name: /save activity/i }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByRole('heading', { name: /^good (morning|afternoon|evening),/i })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /activities (&|and|\/) record/i }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 30_000 });

  expect(diagnostics.consoleErrors, diagnostics.consoleErrors.join('\n')).toEqual([]);
  expect(diagnostics.failedRequests, diagnostics.failedRequests.join('\n')).toEqual([]);
  expect(diagnostics.badResponses, diagnostics.badResponses.join('\n')).toEqual([]);
});

test('confirmed new faculty can upload, attach and download evidence', async ({ page }) => {
  const email = process.env.QA_NEW_USER_EMAIL;
  const password = process.env.QA_NEW_USER_PASSWORD;
  test.skip(!email || !password, 'Set QA_NEW_USER_EMAIL and QA_NEW_USER_PASSWORD for the evidence flow.');
  test.setTimeout(120_000);

  const diagnostics = collectDiagnostics(page);
  const activityTitle = `Browser QA evidence activity ${Date.now()}`;
  const fileName = 'browser-qa-evidence.pdf';
  await page.goto('/login');
  await page.locator('#signin-email').fill(email);
  await page.locator('#signin-password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).last().click();
  await expect(page.getByRole('heading', { name: /^good (morning|afternoon|evening),/i })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /activities (&|and|\/) record/i }).click();
  await expect(page.getByRole('heading', { name: /activities & submissions/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /add activity/i }).last().click();
  await page.locator('#activity-title').fill(activityTitle);
  await page.locator('#activity-category').selectOption('teaching');
  await page.locator('#activity-start').fill('2026-08-12');
  await page.locator('#activity-year').fill('2025-26');
  await page.locator('#activity-description').fill('Created for the real evidence storage browser check.');
  await page.getByRole('button', { name: /save activity/i }).click();
  await expect(page.getByText(activityTitle, { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Evidence Library', exact: true }).click();
  await expect(page.getByRole('heading', { name: /evidence & proof library/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('combobox').selectOption({ label: activityTitle });
  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% browser QA evidence\n%%EOF\n'),
  });
  await page.getByRole('button', { name: /upload file/i }).click();
  await expect(page.getByText(fileName, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /activities (&|and|\/) record/i }).click();
  await expect(page.getByText(activityTitle, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Attached', { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Evidence Library', exact: true }).click();
  await expect(page.getByText(fileName, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await expect(page.getByRole('heading', { name: /^good (morning|afternoon|evening),/i })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Evidence Library', exact: true }).click();
  await expect(page.getByText(fileName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const downloadPopup = page.waitForEvent('popup', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Download', exact: true }).first().click();
  const downloadPage = await downloadPopup;
  await downloadPage.waitForLoadState('domcontentloaded').catch(() => {});
  expect(downloadPage.url()).toMatch(/storage|supabase/);

  expect(diagnostics.consoleErrors, diagnostics.consoleErrors.join('\n')).toEqual([]);
  expect(diagnostics.failedRequests, diagnostics.failedRequests.join('\n')).toEqual([]);
  expect(diagnostics.badResponses, diagnostics.badResponses.join('\n')).toEqual([]);
});

test('faculty and admin complete the appraisal review loop without a manual refresh', async ({ browser }) => {
  const facultyEmail = process.env.QA_NEW_USER_EMAIL;
  const facultyPassword = process.env.QA_NEW_USER_PASSWORD;
  const adminEmail = process.env.QA_ADMIN_EMAIL;
  const adminPassword = process.env.QA_ADMIN_PASSWORD;
  test.skip(!facultyEmail || !facultyPassword || !adminEmail || !adminPassword, 'Set QA_NEW_USER_* and QA_ADMIN_* for the two-browser appraisal flow.');
  test.setTimeout(180_000);

  const facultyContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const facultyPage = await facultyContext.newPage();
  const adminPage = await adminContext.newPage();
  const facultyDiagnostics = collectDiagnostics(facultyPage);
  const adminDiagnostics = collectDiagnostics(adminPage);
  const login = async (page, email, password) => {
    await page.goto('/login');
    await page.locator('#signin-email').fill(email);
    await page.locator('#signin-password').fill(password);
    await page.getByRole('button', { name: /sign in/i }).last().click();
  };

  try {
    await Promise.all([
      login(facultyPage, facultyEmail, facultyPassword),
      login(adminPage, adminEmail, adminPassword),
    ]);
    await expect(facultyPage.getByRole('heading', { name: /^good (morning|afternoon|evening),/i })).toBeVisible({ timeout: 30_000 });
    await expect(adminPage.getByRole('heading', { name: /institution admin console/i })).toBeVisible({ timeout: 30_000 });

    await facultyPage.getByRole('button', { name: /self-appraisal/i }).click();
    await expect(facultyPage.getByRole('heading', { name: /self-appraisal/i })).toBeVisible({ timeout: 20_000 });
    await expect(facultyPage.getByRole('button', { name: /generate draft/i })).toBeEnabled({ timeout: 20_000 });
    await facultyPage.getByRole('button', { name: /generate draft/i }).click();
    await expect(facultyPage.getByRole('button', { name: /submit appraisal/i })).toBeVisible({ timeout: 30_000 });
    await facultyPage.getByRole('button', { name: /submit appraisal/i }).click();
    await expect(facultyPage.getByText('submitted', { exact: true })).toBeVisible({ timeout: 30_000 });

    const adminInspect = adminPage.getByRole('button', { name: /inspect/i }).first();
    await expect(adminInspect).toBeVisible({ timeout: 30_000 });
    await adminInspect.click();
    const dialog = adminPage.getByRole('dialog', { name: /submission review/i });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole('heading', { name: /browser qa .* faculty/i })).toBeVisible({ timeout: 20_000 });
    await dialog.getByPlaceholder(/write a comment/i).fill('Please attach supporting evidence before final approval.');
    await dialog.getByRole('button', { name: /request changes/i }).click();
    await expect(dialog.getByText('Returned', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    await expect(facultyPage.getByText('returned', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(facultyPage.getByRole('button', { name: /submit appraisal/i })).toBeEnabled({ timeout: 20_000 });
    await facultyPage.getByRole('button', { name: /submit appraisal/i }).click();
    await expect(facultyPage.getByText('submitted', { exact: true })).toBeVisible({ timeout: 30_000 });

    await expect(dialog.getByText('Submitted', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: /approve/i }).click();
    await expect(dialog.getByText('Approved', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(facultyPage.getByText('approved', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    const pdfPopup = facultyPage.waitForEvent('popup', { timeout: 30_000 });
    await facultyPage.getByRole('button', { name: /download pdf/i }).click();
    const pdfPage = await pdfPopup;
    await pdfPage.waitForLoadState('domcontentloaded').catch(() => {});
    expect(pdfPage.url()).toMatch(/storage|supabase/);
  } finally {
    await facultyContext.close();
    await adminContext.close();
  }

  expect(facultyDiagnostics.consoleErrors, facultyDiagnostics.consoleErrors.join('\n')).toEqual([]);
  expect(facultyDiagnostics.failedRequests, facultyDiagnostics.failedRequests.join('\n')).toEqual([]);
  expect(facultyDiagnostics.badResponses, facultyDiagnostics.badResponses.join('\n')).toEqual([]);
  expect(adminDiagnostics.consoleErrors, adminDiagnostics.consoleErrors.join('\n')).toEqual([]);
  expect(adminDiagnostics.failedRequests, adminDiagnostics.failedRequests.join('\n')).toEqual([]);
  expect(adminDiagnostics.badResponses, adminDiagnostics.badResponses.join('\n')).toEqual([]);
});

test('faculty can paste a Google Scholar profile: mismatch is rejected, a real import updates the dashboard count and survives reload, and a re-paste is not double-counted', async ({ page }) => {
  const email = process.env.QA_FACULTY_EMAIL;
  const password = process.env.QA_FACULTY_PASSWORD;
  test.skip(!email || !password, 'Set QA_FACULTY_EMAIL and QA_FACULTY_PASSWORD for the live Scholar import flow.');
  test.setTimeout(120_000);

  const diagnostics = collectDiagnostics(page);
  const publicationCount = (json) => json?.category_counts?.publication ?? json?.data?.category_counts?.publication ?? 0;

  await page.goto('/login');
  await page.locator('#signin-email').fill(email);
  await page.locator('#signin-password').fill(password);
  const initialDashboard = page.waitForResponse((res) => res.url().includes('/dashboard/faculty') && res.request().method() === 'GET');
  await page.getByRole('button', { name: /sign in/i }).last().click();
  await expect(page.getByRole('heading', { name: /^good (morning|afternoon|evening),/i })).toBeVisible({ timeout: 30_000 });
  const beforeCount = publicationCount(await (await initialDashboard).json());

  await page.getByRole('button', { name: /activities (&|and|\/) record/i }).click();
  await expect(page.getByRole('heading', { name: /activities & submissions/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Get Google Scholar')).toBeVisible({ timeout: 15_000 });
  const pasteBox = page.getByLabel('Pasted Google Scholar profile content');

  // 1. A pasted page whose owner isn't this faculty member must be rejected,
  //    with nothing written -- the identity gate has no override.
  const mismatchText = [
    'Someone Else Entirely', 'Professor of Physics', '', 'Citations', '3', '', 'h-index', '2', '', 'i10-index', '1', '',
    'Title', 'A Completely Unrelated Paper By Someone Else', 'Someone Else Entirely, A Colleague',
    'Journal of Physics, 1, 2021', 'Cited by 3',
  ].join('\n');
  await pasteBox.fill(mismatchText);
  await pasteBox.press('Enter');
  await expect(page.getByText(/doesn't match your profile name/i)).toBeVisible({ timeout: 30_000 });

  // 2. A genuine, new-to-this-record publication under the real profile name
  //    should auto-import with no per-item confirm click, and the dashboard
  //    count should reflect exactly the delta the API reports.
  const newPaperTitle = `Explainable AI Techniques for Clinical Decision Support Systems ${Date.now()}`;
  const scholarText = [
    'Dr. Priya Menon', 'Professor of Computer Science', '', 'Citations', '1842', '', 'h-index', '21', '', 'i10-index', '34', '',
    'Title', newPaperTitle, 'Priya Menon, Arjun Rao', 'Journal of Biomedical Informatics, 58, 2023', 'Cited by 41',
  ].join('\n');
  await pasteBox.fill(scholarText);
  await pasteBox.press('Enter');
  await expect(page.getByText(/^Imported 1 publication for/i)).toBeVisible({ timeout: 30_000 });

  const afterImportDashboard = page.waitForResponse((res) => res.url().includes('/dashboard/faculty') && res.request().method() === 'GET');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const afterImportCount = publicationCount(await (await afterImportDashboard).json());
  expect(afterImportCount, 'dashboard publication count should increase by exactly 1 newly-imported item').toBe(beforeCount + 1);

  // 3. The count must persist from the database across a reload (a fresh
  //    page load defaults back to the dashboard view), not just live in
  //    client-side state.
  const afterReloadDashboard = page.waitForResponse((res) => res.url().includes('/dashboard/faculty') && res.request().method() === 'GET');
  await page.reload();
  await expect(page.getByRole('heading', { name: /^good (morning|afternoon|evening),/i })).toBeVisible({ timeout: 30_000 });
  const afterReloadCount = publicationCount(await (await afterReloadDashboard).json());
  expect(afterReloadCount, 'the imported publication must persist across a reload, not just live in client state').toBe(beforeCount + 1);

  // 4. Re-pasting the same profile must not create a duplicate or inflate
  //    the count a second time.
  await page.getByRole('button', { name: /activities (&|and|\/) record/i }).click();
  await expect(page.getByRole('heading', { name: /activities & submissions/i })).toBeVisible({ timeout: 20_000 });
  await pasteBox.fill(scholarText);
  await pasteBox.press('Enter');
  await expect(page.getByText(/^Imported 0 publications for/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/already accounted for and skipped/i)).toBeVisible();

  const afterRepasteDashboard = page.waitForResponse((res) => res.url().includes('/dashboard/faculty') && res.request().method() === 'GET');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const afterRepasteCount = publicationCount(await (await afterRepasteDashboard).json());
  expect(afterRepasteCount, 're-pasting the same profile must not double-count').toBe(beforeCount + 1);

  expect(diagnostics.consoleErrors, diagnostics.consoleErrors.join('\n')).toEqual([]);
  expect(diagnostics.failedRequests, diagnostics.failedRequests.join('\n')).toEqual([]);
});
