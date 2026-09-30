// The entrance grid has 24 entries: 21 compiled (animate__*) and the "Infinite loop" group — Glow, Rocking, Bounce — whose value is a bare class the
// public stylesheet already ships. "Disable animations on mobile" is class.disableAnimationsOnMobile.value; the builder compiles it to a no-animation rule.
// (page builder e1b163ff: entranceAnimation table, INFINITE_LOOP_PREVIEW, generateAnimationCustomizationStyles.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entranceClass, entranceCss, stripAnimationCss, ENTRANCE_ANIMATIONS, LOOP_ANIMATIONS } from '../core/page-animation.mjs';

test('the entrance grid is the builder\'s 24: 21 compiled + 3 button loops', () => {
  assert.equal(ENTRANCE_ANIMATIONS.length, 24);
  assert.deepEqual(LOOP_ANIMATIONS, ['buttonPulseGlow', 'buttonRocking', 'buttonBounce']);
});

test('a loop stores the bare class, no timing knobs, only on a button', () => {
  assert.deepEqual(entranceClass({ name: 'buttonRocking' }, 'button'), { entranceAnimation: { value: 'buttonRocking' } });
  assert.throws(() => entranceClass({ name: 'buttonBounce' }, 'heading'), /offers on buttons/);
  assert.throws(() => entranceClass({ name: 'buttonPulseGlow', duration: 2 }, 'button'), /hides its timing knobs \(duration given\)/);
  assert.deepEqual(entranceClass({ name: 'fadeIn', duration: 2 }, 'heading'), { entranceAnimation: { value: 'animate__animated animate__fadeIn' }, animationDuration: { value: 2 } }, 'a compiled one is unchanged');
});

test('a loop compiles to nothing (the class is global); disableOnMobile compiles to the builder\'s no-animation rule', () => {
  assert.equal(entranceCss('button-A1', { entranceAnimation: { value: 'buttonPulseGlow' } }), '');
  const mob = entranceClass({ name: 'buttonPulseGlow', disableOnMobile: true }, 'button');
  assert.deepEqual(mob.disableAnimationsOnMobile, { value: true });
  assert.equal(entranceCss('button-A1', mob), '@media (max-width:1024px){#button-A1{animation:none!important}}.--mobile #button-A1{animation:none!important}');
  assert.equal(entranceCss('button-A1', entranceClass({ name: 'buttonPulseGlow', disableOnMobile: false }, 'button')), '');
  assert.throws(() => entranceClass({ name: 'fadeIn', disableOnMobile: 'yes' }, 'heading'), /true or false/);
});

test('disableOnMobile rides along with a compiled entrance and strip removes both', () => {
  const cls = entranceClass({ name: 'fadeInUp', duration: 2, disableOnMobile: true }, 'heading');
  const css = entranceCss('heading-A1', cls);
  assert.match(css, /^\.animate__fadeInUp-heading-A1\{animation:fadeInUp-heading-A1 2s linear 0s forwards!important/);
  assert.match(css, /@media \(max-width:1024px\)\{#heading-A1\{animation:none!important\}\}\.--mobile #heading-A1\{animation:none!important\}$/);
  assert.equal(stripAnimationCss(`.x{color:red}${css}`, 'heading-A1'), '.x{color:red}');
});
