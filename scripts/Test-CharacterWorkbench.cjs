const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');

async function main() {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 664 } });
    const errors = [];
    const warnings = [];
    const ignored = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') {
            if (message.location().url.endsWith('/favicon.ico') && message.text().includes('404'))
                ignored.push({ url: message.location().url, message: message.text() });
            else errors.push(message.text());
        }
        if (message.type() === 'warning') warnings.push(message.text());
    });
    const state = () => page.evaluate(() => {
        window.unityInstance.SendMessage('Studio Workbench', 'Inspect', '');
        return window.studioState;
    });
    const wait = async (predicate, argument) => {
        await page.waitForFunction(({ source, argument }) => {
            window.unityInstance.SendMessage('Studio Workbench', 'Inspect', '');
            return new Function('state', 'argument', `return (${source})(state, argument)`)(window.studioState, argument);
        }, { source: predicate.toString(), argument }, { timeout: 90000, polling: 150 });
        return state();
    };
    const frames = async () => {
        const before = await state();
        await wait((current, frame) => current.frame > frame + 5, before.frame);
    };
    const click = async name => {
        const current = await state();
        const element = current.elements.find(element => element.name === name);
        assert(element?.enabled, `Missing/disabled control ${name}`);
        const bounds = element.bounds;
        assert(bounds.y >= 0 && bounds.y + bounds.height <= current.root.height, `Control outside viewport: ${name}`);
        await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { delay: 180 });
        await frames();
    };
    const changed = async action => {
        const before = await state();
        await action();
        return wait((current, revision) => current.ready && !current.busy && !current.pending && current.revision > revision, before.revision);
    };
    const reveal = async name => {
        for (let attempt = 0; attempt < 12; attempt++) {
            const current = await state();
            const element = current.elements.find(element => element.name === name);
            assert(element, `Missing catalog item ${name}`);
            const top = Math.max(...current.elements.filter(item => item.name.startsWith('section-')).map(item => item.bounds.y + item.bounds.height)) + 8;
            if (element.bounds.y >= top && element.bounds.y + element.bounds.height < current.root.height - 8) return;
            await page.mouse.move(180, 430);
            await page.mouse.wheel(0, element.bounds.y < top ? -160 : 160);
            await frames();
        }
        throw new Error(`Unable to reveal ${name}`);
    };
    const toolbar = current => {
        const names = ['previous-step', 'next-step', 'randomize-character', 'reset-character', 'save-character', 'restore-character'];
        const bounds = names.map(name => current.elements.find(element => element.name === name).bounds);
        for (const box of bounds) {
            assert(box.x >= current.viewport.x && box.y >= 0 && box.y + box.height < 130, 'Toolbar is not upper-right');
            assert(box.x + box.width <= current.root.width, 'Toolbar overflows');
        }
        for (let first = 0; first < bounds.length; first++) {
            for (let second = first + 1; second < bounds.length; second++) {
                const left = bounds[first], right = bounds[second];
                assert(!(left.x < right.x + right.width && left.x + left.width > right.x &&
                    left.y < right.y + right.height && left.y + left.height > right.y), 'Toolbar overlaps');
            }
        }
        assert(current.elements.every(element => !element.numericInput), 'Numeric slider input remains');
        const name = current.elements.find(element => element.name === 'character-name').bounds;
        assert(Math.abs(name.x + name.width / 2 - current.viewport.x - current.viewport.width / 2) < 2, 'Name is not centered in right viewport');
        assert(name.y > current.root.height * 0.75 && name.x >= current.viewport.x, 'Name is not bottom-right');
    };
    const poseLayout = current => {
        const poses = current.elements.filter(element => /^pose-\d$/.test(element.name));
        assert.equal(poses.length, 7, 'Missing pose choices');
        const tools = current.elements.filter(element => ['previous-step', 'next-step', 'randomize-character', 'reset-character', 'save-character', 'restore-character'].includes(element.name));
        const top = Math.max(...tools.map(element => element.bounds.y + element.bounds.height));
        const bottom = current.elements.find(element => element.name === 'character-name').bounds.y;
        const cameraRight = (current.camera.x + current.camera.width) * current.root.width;
        for (let index = 0; index < poses.length; index++) {
            const box = poses[index].bounds;
            assert(box.y >= top && box.y + box.height <= bottom, 'Pose choices overlap tools/name');
            assert(box.x >= cameraRight && box.x + box.width <= current.root.width, 'Pose choices overlap camera or overflow');
            assert(poses[index].textWidth <= box.width, 'Pose label overflows');
            if (index > 0) assert(box.y >= poses[index - 1].bounds.y + poses[index - 1].bounds.height && Math.abs(box.x - poses[0].bounds.x) < 1, 'Pose choices are not vertical');
        }
    };
    const choosePose = async index => {
        const before = await state();
        await click('pose-' + index);
        const after = await wait((current, index) => current.selectedPose === index, index);
        assert(after.elements.find(element => element.name === 'pose-' + index).selected, 'Pose selection stale');
        assert.equal(after.definition, before.definition, 'Pose changed saved appearance');
        assert.equal(after.panelRevision, before.panelRevision, 'Pose rebuilt left panel');
        assert.equal(after.scrollY, before.scrollY, 'Pose reset scroll');
        assert.equal(after.rotation, before.rotation, 'Pose click rotated character');
        assert.deepEqual(after.characterPosition, before.characterPosition, 'Pose translated character');
        return after;
    };
    try {
        await page.goto(process.argv[3] || 'http://127.0.0.1:8520/');
        await page.waitForFunction(() => window.studioRuntimeReady, null, { timeout: 180000 });
        const initial = await wait(current => current?.ready && current.layoutReady && current.elements.some(element => element.name === 'gender-male'));
        toolbar(initial);
        poseLayout(initial);
        assert.equal(initial.selectedPose, 0, 'Default pose is not still');
        assert(initial.renderedMeshes > 0 && initial.meshInView, 'Character mesh unavailable');
        assert.equal(initial.boneAnimationEnabled, false, 'Embedded physics remains active');
        await wait((current, frame) => current.frame > frame + 120, initial.frame);
        assert.equal((await state()).pose, initial.pose, 'Character moves while idle');
        console.log(JSON.stringify({ startup: { race: initial.race, guarded: initial.guardedPhysicsSlots, skipped: initial.skippedPhysicsChains } }));
        const fixedPoses = new Set([initial.pose]);
        for (let index = 1; index <= 3; index++) {
            const selected = await choosePose(index);
            assert.equal(selected.moving, false);
            await wait((current, frame) => current.frame > frame + 60, selected.frame);
            assert.equal((await state()).pose, selected.pose, 'Fixed pose is moving');
            fixedPoses.add(selected.pose);
        }
        assert.equal(fixedPoses.size, 4, 'Fixed poses are not distinct');
        for (let index = 4; index <= 6; index++) {
            const selected = await choosePose(index);
            assert.equal(selected.moving, true);
            await wait((current, pose) => current.pose !== pose, selected.pose);
            const until = await page.evaluate(duration => performance.now() + (duration + 0.3) * 1000, selected.poseDuration);
            await page.waitForFunction(until => performance.now() > until, until, { timeout: 30000 });
            const cycled = await state();
            await wait((current, pose) => current.pose !== pose, cycled.pose);
            assert.deepEqual((await state()).characterPosition, selected.characterPosition, 'Looping motion drifts');
            console.log(JSON.stringify({ pose: index, moving: true, completedCycle: selected.poseDuration }));
        }
        const still = await choosePose(0);
        await wait((current, frame) => current.frame > frame + 60, still.frame);
        assert.equal((await state()).pose, still.pose, 'Returning to still did not stop motion');

        await click('section-\u80a4\u8272');
        await wait(current => current.elements.some(element => element.name === 'skin-tone'));
        const tones = [];
        for (const fraction of [0.15, 0.85]) {
            const current = await state();
            const box = current.elements.find(element => element.name === 'skin-tone').bounds;
            const after = await changed(async () => {
                await page.mouse.click(box.x + 12 + (box.width - 24) * fraction, box.y + box.height - 15, { delay: 180 });
            });
            assert(Math.abs(after.skinTone - fraction) < 0.12, 'Skin slider did not apply expected tone');
            tones.push({ tone: after.skinTone, definition: after.definition });
        }
        assert.notEqual(tones[0].definition, tones[1].definition, 'Skin mutation did not change recipe');
        console.log(JSON.stringify({ skinTones: tones.map(tone => tone.tone) }));

        const rotation = (await state()).rotation;
        await click('next-step');
        await wait(current => current.elements.some(element => element.name.startsWith('dna-')));
        toolbar(await state());
        await changed(() => click('randomize-character'));
        await click('previous-step');
        assert.equal((await state()).rotation, rotation, 'Toolbar initiated character drag');
        const reset = await changed(() => click('reset-character'));
        assert.equal(reset.definition, initial.definition, 'Reset did not restore initial character');

        for (const section of ['\u8138\u578b', '\u773c\u775b', '\u7709\u6bdb']) {
            await click('category-2');
            await click('section-' + section);
            const current = await state();
            const cards = current.elements.filter(element => element.name.startsWith('region-'));
            const brows = current.elements.filter(element => element.name.startsWith('wear-'));
            assert(cards.length > 1 || brows.length > 1, `Insufficient presets for ${section}`);
            if (cards.length > 1) {
                const chosen = cards.find(card => !card.selected) || cards[0];
                await reveal(chosen.name);
                const before = await state();
                const parameters = before.elements.filter(element => element.name.startsWith('dna-')).map(element => element.name.slice(4));
                const after = await changed(() => click(chosen.name));
                assert.equal(after.panelRevision, before.panelRevision, 'Regional preset rebuilt the left panel');
                assert.equal(after.scrollY, before.scrollY, 'Regional preset reset the scroll');
                assert(after.elements.find(element => element.name === chosen.name).selected, 'Regional preset selection not synchronized');
                const original = JSON.parse(before.definition), updated = JSON.parse(after.definition);
                const originalRegion = original.Dna.filter(value => parameters.includes(value.Name));
                const updatedRegion = updated.Dna.filter(value => parameters.includes(value.Name));
                assert.notDeepEqual(updatedRegion, originalRegion, 'Regional preset did not change DNA');
                original.Dna = original.Dna.filter(value => !parameters.includes(value.Name));
                updated.Dna = updated.Dna.filter(value => !parameters.includes(value.Name));
                assert.deepEqual(updated, original, 'Regional preset modified other appearance data');
            }
            if (brows.length > 1) {
                const chosen = brows.find(card => !card.selected) || brows[0];
                await reveal(chosen.name);
                const before = await state();
                const after = await changed(() => click(chosen.name));
                assert.equal(after.panelRevision, before.panelRevision, 'Eyebrow choice rebuilt the left panel');
                assert.equal(after.scrollY, before.scrollY, 'Eyebrow choice reset the scroll');
                assert(after.elements.find(element => element.name === chosen.name).selected, 'Eyebrow choice did not apply');
                assert.deepEqual(JSON.parse(after.definition).Dna, JSON.parse(before.definition).Dna, 'Eyebrow style changed face DNA');
            }
            console.log(JSON.stringify({ section, regionPresets: cards.length, wardrobePresets: brows.length }));
        }
        await changed(() => click('reset-character'));

        for (const gender of ['male', 'female']) {
            await choosePose(2);
            await click('category-0');
            await click('section-\u6027\u522b\u4e0e\u9884\u8bbe');
            await changed(() => click('gender-' + gender));
            assert.equal((await state()).selectedPose, 2, 'Gender rebuild lost fixed pose');
            await click('category-3');
            const hair = (await state()).elements.filter(element => element.name.startsWith('wear-') && element.bounds.y + element.bounds.height < 560).slice(0, 2);
            assert(hair.length > 0, 'No visible hair choices');
            for (const choice of hair) await changed(() => click(choice.name));
            const pigtails = (await state()).elements.find(element => element.name.startsWith('wear-') && /pigtail/i.test(element.name));
            assert(pigtails, 'Pigtail physics asset unavailable');
            await reveal(pigtails.name);
            const beforeHair = await state();
            const animated = await changed(() => click(pigtails.name));
            assert(animated.guardedPhysicsSlots > 0, 'Sway adapter was not installed for pigtails');
            assert.equal(animated.panelRevision, beforeHair.panelRevision, 'Wardrobe rebuilt the left panel');
            assert.equal(animated.scrollY, beforeHair.scrollY, 'Wardrobe reset the scroll');
            assert.equal(animated.selectedPose, 2, 'Wardrobe rebuild lost fixed pose');
            assert(animated.elements.find(element => element.name === pigtails.name).selected, 'Wardrobe selection stale');
            await wait((current, frame) => current.frame > frame + 60, animated.frame);
            assert.equal((await state()).pose, animated.pose, 'Character moves after hair/gender rebuild');
            console.log(JSON.stringify({ pigtails: pigtails.name, guarded: animated.guardedPhysicsSlots, skipped: animated.skippedPhysicsChains }));
            await click('category-3');
            const remove = (await state()).elements.find(element => element.name === 'remove-Hair');
            assert(remove.tile, 'None option is not a tile');
            await reveal('remove-Hair');
            const removed = await changed(() => click('remove-Hair'));
            assert(removed.elements.find(element => element.name === 'remove-Hair').selected, 'None tile selection stale');
            const current = await state();
            console.log(JSON.stringify({ race: current.race, testedHair: hair.map(item => item.name), guarded: current.guardedPhysicsSlots, skipped: current.skippedPhysicsChains }));
            await choosePose(5);
            await reveal(hair[0].name);
            const motionRebuilt = await changed(() => click(hair[0].name));
            assert.equal(motionRebuilt.selectedPose, 5, 'Rebuild lost motion state');
            await wait((current, pose) => current.pose !== pose, motionRebuilt.pose);
            await choosePose(0);
        }
        await changed(() => click('reset-character'));

        const beforeDrag = await state();
        const center = { x: beforeDrag.viewport.x + beforeDrag.viewport.width / 2, y: beforeDrag.viewport.height / 2 };
        await page.mouse.move(center.x, center.y);
        await page.mouse.down();
        await page.mouse.move(center.x + 100, center.y, { steps: 15 });
        await page.mouse.up();
        await frames();
        const dragged = await state();
        assert(Math.abs(dragged.rotation - beforeDrag.rotation) > 10, 'Character drag failed');
        assert.equal(dragged.definition, beforeDrag.definition, 'Drag changed character recipe');
        await page.mouse.move(center.x + 180, center.y, { steps: 8 });
        await frames();
        assert.equal((await state()).rotation, dragged.rotation, 'Drag did not release');

        await page.setViewportSize({ width: 390, height: 844 });
        await wait(current => current.root.width === 390);
        await click('category-2');
        await click('section-\u773c\u775b');
        const narrow = await state();
        toolbar(narrow);
        poseLayout(narrow);
        const narrowRun = await choosePose(6);
        await wait((current, pose) => current.pose !== pose && current.meshInView, narrowRun.pose);
        await choosePose(0);
        assert(narrow.meshInView && narrow.viewport.y === 0 && narrow.viewport.height === 844, 'Narrow layout failed');
        assert(narrow.elements.some(element => element.name.startsWith('dna-')), 'No narrow DNA controls');
        console.log(JSON.stringify({ narrowViewport: narrow.viewport, errors, warnings }));
        assert.equal(errors.length, 0, 'Browser errors occurred');
        console.log('PASS: seven poses, fixed holds, motion loops, in-place motion, rebuild persistence, desktop/narrow pose layout, appearance and editing regressions.');
    } finally {
        console.log(JSON.stringify({ finalErrors: errors, finalWarnings: warnings, ignored }));
        await browser.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });