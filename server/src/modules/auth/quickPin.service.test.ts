import assert from "node:assert/strict";
import test from "node:test";
import { validateQuickPin, validateQuickPinLength, isAllowedPinLength } from "./quickPin.service.js";

test("quick PIN requires 6 to 8 numeric digits", () => {
  for (const invalid of ["", "12345", "123456789", "12a456", "１２３４５６", "12 4567"]) {
    assert.equal(validateQuickPin(invalid), false, invalid);
  }
  assert.equal(validateQuickPin("804297"), true);
  assert.equal(validateQuickPin("80429735"), true);
});

test("quick PIN rejects obvious sequences and repetition", () => {
  for (const invalid of ["000000", "111111", "123456", "654321", "12345678", "87654321", "121212", "112233", "123123", "99999999", "234567", "765432", "454545"]) {
    assert.equal(validateQuickPin(invalid), false, invalid);
  }
});

test("PIN policy supports only lengths 6 through 8", () => {
  for (const length of [6, 7, 8]) assert.equal(isAllowedPinLength(length), true);
  for (const length of [0, 4, 5, 9, 6.5]) assert.equal(isAllowedPinLength(length), false);
  assert.equal(validateQuickPinLength("804297", 6), true);
  assert.equal(validateQuickPinLength("804297", 8), false);
  assert.equal(validateQuickPinLength("80429735", 8), true);
  assert.equal(validateQuickPinLength("123456", 6), false);
});
