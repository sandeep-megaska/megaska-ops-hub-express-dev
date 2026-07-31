import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const otpSource = readFileSync('extensions/megaska-otp/assets/loopd2c-otp.js', 'utf8');
const embedSource = readFileSync('extensions/megaska-otp/blocks/megaska-otp-embed.liquid', 'utf8');

const mustContain = (source, needle) => assert.ok(source.includes(needle), `missing ${needle}`);

test('OTP embed dispatches a focused runtime config ready event after merging valid config', () => {
  mustContain(embedSource, 'function dispatchRuntimeConfigReady()');
  mustContain(embedSource, 'new CustomEvent("loopdesk:runtime-config-ready"');
  mustContain(embedSource, 'otpModalBranding:');
  assert.ok(
    embedSource.indexOf('window.LoopDeskConfig = Object.assign') < embedSource.lastIndexOf('dispatchRuntimeConfigReady();'),
    'runtime config ready event should be dispatched after config merge'
  );
});

test('OTP modal separates structural creation from presentation branding updates', () => {
  mustContain(otpSource, 'function applyOtpModalBranding(modal)');
  mustContain(otpSource, 'if (modal) {\n      applyOtpModalBranding(modal);\n      return modal;\n    }');
  mustContain(otpSource, 'document.createElement("img")');
  mustContain(otpSource, 'document.createElement("span")');
  mustContain(otpSource, 'textContent = branding.heading');
  mustContain(otpSource, 'textContent = branding.description');
  mustContain(otpSource, 'textContent = branding.inputHelperText');
  mustContain(otpSource, 'textContent = branding.privacyText');
});

test('OTP success message is merchant-configurable via otpModalBranding', () => {
  mustContain(otpSource, 'successMessage: String(config.successMessage || "You\'re in!").trim() || "You\'re in!"');
  mustContain(otpSource, 'renderSuccessStep(opts.successMessage || getOtpModalBranding().successMessage);');
});

test('OTP modal includes stable presentation hooks and listens for runtime config readiness', () => {
  [
    'data-megaska-otp-logo-wrap',
    'data-megaska-otp-brand-text',
    'data-megaska-otp-offer-container',
    'data-megaska-otp-title',
    'data-megaska-otp-description',
    'data-megaska-otp-trust-strip',
    'data-megaska-phone-hint',
    'data-megaska-otp-privacy',
    'window.addEventListener("loopdesk:runtime-config-ready"'
  ].forEach((needle) => mustContain(otpSource, needle));
});
