// Recovery reads never report success until rollback AND close have succeeded.
// An earlier operation/connection error remains the primary diagnostic; cleanup
// is always attempted but must not replace that error or turn failure into success.
export async function withRecoveryReadClient(client, inspect) {
  let connected = false;
  let operationFailed = false;
  let operationError;
  let cleanupError;
  let cleanupFailed = false;
  let result;
  try {
    await client.connect();
    connected = true;
    result = await inspect();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }
  if (connected) {
    try {
      await client.query('ROLLBACK');
    } catch (error) {
      cleanupFailed = true;
      cleanupError = error;
    }
  }
  try {
    await client.end();
  } catch (error) {
    if (!cleanupFailed) cleanupError = error;
    cleanupFailed = true;
  }
  if (operationFailed) throw operationError;
  if (cleanupFailed) throw cleanupError;
  return result;
}
