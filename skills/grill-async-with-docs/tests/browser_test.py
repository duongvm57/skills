"""Exercise the actual offline HTML across browser contexts; no server needed."""
import argparse
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    skill = Path(__file__).resolve().parents[1]
    html = out / 'interview.html'
    subprocess.run(['node', str(skill / 'scripts/grill.mjs'), 'render', str(skill / 'examples/cancellation.packet.json'), '--out', str(html)], check=True)
    failures, requests = [], []
    checks = []

    def record(name):
        checks.append(name)
        print('PASS:', name)

    def watch(page):
        page.on('pageerror', lambda err: failures.append(str(err)))
        page.on('request', lambda req: requests.append(req.url) if req.url.startswith(('http:', 'https:')) else None)

    def choose(page, q, value):
        page.locator(f'#question-{q} input[value="{value}"]').check()

    def state(page, q):
        return page.locator(f'#question-{q}').get_attribute('data-state')

    def saved(page):
        return page.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('grill:'))))")

    def export(page, filename):
        with page.expect_download() as event:
            page.locator('#export-button').click()
        path = out / filename
        event.value.save_as(path)
        return path

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        page = context.new_page()
        watch(page)
        page.goto(html.as_uri())
        page.wait_for_load_state('networkidle')
        assert state(page, 'S02') == 'pending'
        expect(page.locator('#panel-tech')).to_be_hidden()
        page.locator('#respondent').fill('Lan / BA')
        choose(page, 'S01', 'partial')
        assert state(page, 'S04') == state(page, 'S05') == 'missing'
        choose(page, 'S02', 'yes')
        choose(page, 'S03', 'shipped')
        choose(page, 'S04', 'keep')
        choose(page, 'S05', 'keep')
        page.get_by_label('S06 Answer', exact=True).fill('0')
        page.get_by_role('button', name='S07 Add row', exact=True).click()
        page.get_by_label('S07 Row 1 Role', exact=True).fill('Customer')
        page.get_by_label('S07 Row 1 Can request cancellation?', exact=True).select_option('yes')
        page.get_by_label('S07 Row 1 Approver / approval conditions', exact=True).fill('Employee confirms before handoff')
        choose(page, 'S08', 'yes')
        page.get_by_label('S09 Answer', exact=True).fill('The carrier confirms the return; the customer pays any extra fee.')
        assert saved(page)['answers']['S06']['value'] == 0
        assert saved(page)['answers']['S07']['value'][0]['role'] == 'Customer'
        assert saved(page)['answers']['S01']['answered_by'] == 'Lan / BA'
        record('BA branch conditions, zero, dynamic rows, and per-answer attribution')

        ba_file = export(page, 'ba-answers.json')
        page.reload()
        page.wait_for_load_state('networkidle')
        expect(page.locator('#question-S01 input[value="partial"]')).to_be_checked()
        assert state(page, 'S06') == 'answered'
        record('same-browser draft restored after reload')

        dev_context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        dev = dev_context.new_page()
        watch(dev)
        dev.goto(html.as_uri())
        dev.wait_for_load_state('networkidle')
        assert state(dev, 'S01') == 'missing'
        dev.locator('#import-file').set_input_files(ba_file)
        expect(dev.locator('#notice')).to_contain_text('Answers imported')
        assert state(dev, 'S06') == 'answered'
        dev.locator('#respondent').fill('Minh / DEV')
        dev.locator('#tab-tech').click()
        expect(dev.locator('#panel-spec')).to_be_hidden()
        choose(dev, 'T01', 'yes')
        choose(dev, 'T02', 'async')
        dev.get_by_label('T03 Answer', exact=True).fill('Persist an idempotency key and refund state; retry using the same key.')
        dev.get_by_label('T04 Answer', exact=True).fill('Store per-line allocations and reconcile aggregate totals.')
        expect(dev.locator('#overall-status')).to_contain_text('Ready for agent review')
        combined_file = export(dev, 'combined-answers.json')
        combined = json.loads(combined_file.read_text())
        assert combined['answers']['T02']['answered_by'] == 'Minh / DEV'
        assert combined['answers']['S01']['answered_by'] == 'Lan / BA'
        record('portable BA → DEV handoff preserves both tabs and original attribution')

        page.locator('#import-file').set_input_files(combined_file)
        expect(page.locator('#notice')).to_contain_text('Answers imported')
        expect(page.locator('#merge-dialog')).not_to_be_visible()
        assert saved(page)['answers']['T02']['value'] == 'async'
        record('nonconflicting combined response merges back into BA draft')

        dev.locator('#tab-spec').click()
        choose(dev, 'S08', 'no')
        expect(dev.locator('#conflicts')).to_be_visible()
        expect(dev.locator('#conflicts')).to_contain_text('BA rejected a pending status')
        changed_file = export(dev, 'changed-answers.json')
        before = saved(page)
        page.locator('#import-file').set_input_files(changed_file)
        expect(page.locator('#merge-dialog')).to_be_visible()
        page.locator('#merge-apply').click()
        expect(page.locator('#merge-error')).to_contain_text('Choose which answer')
        assert saved(page) == before
        page.locator('input[name="merge-S08"][value="incoming"]').check()
        page.locator('#merge-apply').click()
        expect(page.locator('#merge-dialog')).not_to_be_visible()
        assert saved(page)['answers']['S08']['value'] == 'no'
        record('conflicting import requires explicit choice and is atomic before apply')

        choose(page, 'S01', 'whole')
        assert state(page, 'S02') == 'needs_review'
        expect(page.locator('#question-S04')).to_be_hidden()
        choose(page, 'S01', 'partial')
        assert state(page, 'S04') == 'needs_review'
        expect(page.locator('#question-S04 .reconfirm')).to_be_visible()
        page.locator('#question-S04 .reconfirm button').click()
        assert state(page, 'S04') == 'answered'
        assert state(page, 'S02') == 'needs_review'
        record('upstream changes invalidate retained answers even after switching back')

        page.locator('#mode-S01').select_option('other')
        page.locator('#note-S01').fill('Only cancel subscriptions; add rules for billing cycles.')
        assert state(page, 'S01') == 'other'
        assert state(page, 'S02') == 'pending'
        page.locator('#mode-S01').select_option('unknown')
        page.locator('#note-S01').fill('Product must confirm the scope.')
        assert state(page, 'S01') == 'unknown'
        assert state(page, 'S02') == 'pending'
        record('Other and Undecided preserve unknown routing instead of choosing a branch')

        mismatch = dict(combined)
        mismatch['revision'] = '999'
        mismatch_path = out / 'wrong-version.json'
        mismatch_path.write_text(json.dumps(mismatch))
        before = saved(page)
        page.locator('#import-file').set_input_files(mismatch_path)
        expect(page.locator('#notice')).to_contain_text('different packet or revision')
        assert saved(page) == before
        record('wrong-version import is rejected without changing the current draft')

        # Treat respondent content strictly as text in history and conflict views.
        payload = '<img src=x onerror="window.injected=true">'
        page.locator('#note-S01').fill(payload)
        page.locator('#note-S01').fill('Add an HTML string to the history')
        page.locator('.history-panel summary').click()
        assert page.evaluate('window.injected === undefined')
        assert page.locator('#history img').count() == 0
        record('respondent text does not execute HTML or scripts')

        # Real file:// screenshots on desktop and a narrow mobile viewport.
        dev.locator('#tab-spec').click()
        dev.locator('#question-S01').scroll_into_view_if_needed()
        dev.screenshot(path=str(out / 'desktop.png'), full_page=False)
        mobile_context = browser.new_context(viewport={'width': 390, 'height': 844}, accept_downloads=True)
        mobile = mobile_context.new_page()
        watch(mobile)
        mobile.goto(html.as_uri())
        mobile.wait_for_load_state('networkidle')
        assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
        mobile.locator('#tab-spec').focus()
        mobile.keyboard.press('ArrowRight')
        expect(mobile.locator('#tab-tech')).to_be_focused()
        expect(mobile.locator('#panel-tech')).to_be_visible()
        mobile.screenshot(path=str(out / 'mobile.png'), full_page=False)
        record('mobile layout fits viewport and tabs support keyboard navigation')

        blocked_context = browser.new_context(accept_downloads=True)
        blocked_context.add_init_script("Object.defineProperty(window, 'localStorage', {get() { throw new Error('disabled'); }});")
        blocked = blocked_context.new_page()
        watch(blocked)
        blocked.goto(html.as_uri())
        blocked.wait_for_load_state('networkidle')
        choose(blocked, 'S01', 'none')
        expect(blocked.locator('#save-status')).to_contain_text('Could not save')
        fallback_file = export(blocked, 'without-local-storage.json')
        assert json.loads(fallback_file.read_text())['answers']['S01']['value'] == 'none'
        record('export still works when browser local storage is unavailable')

        assert not failures, failures
        assert not requests, requests
        record('no page errors or external network requests')
        browser.close()

    subprocess.run(['node', str(skill / 'scripts/grill.mjs'), 'reconcile', str(skill / 'examples/cancellation.packet.json'), str(combined_file), '--out', str(out / 'reconciled')], check=True)
    report = json.loads((out / 'reconciled/report.json').read_text())
    assert report['ready_for_review'] is True
    assert report['semantic_review_required'] is True
    record('browser export is accepted and recomputed by the CLI')
    (out / 'results.json').write_text(json.dumps({'passed': len(checks), 'checks': checks, 'page_errors': failures, 'external_requests': requests}, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
