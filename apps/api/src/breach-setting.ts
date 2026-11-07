// SPDX-License-Identifier: AGPL-3.0-or-later
//
// At start-up the API records the breached-password check setting (ADR 0010),
// so turning TPS_AUTH_BREACH_CHECK off leaves a password_check_setting_changed
// audit event. If it cannot be recorded the API does not start: a change must
// never go unaudited.

/** True if the setting is recorded. False, after a fatal log, if it is not. */
export async function recordBreachSetting(
  auth: { recordBreachCheckSetting(): Promise<boolean> },
  log: { fatal(bindings: object, message: string): void },
): Promise<boolean> {
  try {
    await auth.recordBreachCheckSetting();
    return true;
  } catch (error) {
    log.fatal({ err: error }, 'The breached-password check setting could not be recorded');
    return false;
  }
}
