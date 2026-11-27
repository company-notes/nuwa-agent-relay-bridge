import { createRequire } from 'node:module';

import { BridgeError } from './BridgeError.js';

type TerminalQR = {
  generate: (text: string, options: { small: boolean }, callback: (rendered: string) => void) => void;
};

const require = createRequire(import.meta.url);
const terminalQR = require('qrcode-terminal') as TerminalQR;

enum LoginStage
{
  Initialize,
  ScanQR,
  ConfirmPIN,
  Resume,
}

export class LineLoginPrompt
{
  private stage = LoginStage.Initialize;

  constructor(private readonly output: (message: string) => void = console.log) {}

  qr(url: string): void
  {
    this.stage = LoginStage.ScanQR;
    this.output('Scan this QR code with the company LINE account on its authorized phone. Confirm the login in LINE.');
    terminalQR.generate(url, { small: true }, rendered => this.output(rendered));
  }

  pin(pin: string): void
  {
    this.stage = LoginStage.ConfirmPIN;
    this.output('Enter this temporary PIN in LINE: ' + pin);
  }

  resume(): void
  {
    this.stage = LoginStage.Resume;
  }

  failure(error: unknown): BridgeError
  {
    const stage = {
      [LoginStage.Initialize]: 'initializing QR login',
      [LoginStage.ScanQR]: 'waiting for QR confirmation or finishing login',
      [LoginStage.ConfirmPIN]: 'confirming PIN or finishing login',
      [LoginStage.Resume]: 'restoring the saved LINE session',
    }[this.stage];

    // Upstream error text can contain credentials. Extract only known status
    // codes, operation names, and error categories; keep all other data private.
    const message = error instanceof Error ? error.message : '';
    const status = /(?:^|\s)status=([1-5][0-9]{2})(?=\s|$)/.exec(message)?.[1];
    const method = /\b(checkQrCodeVerified|checkPinCodeVerified|createSession|createQrCodeForSecure|createQrCode|qrCodeLoginV2ForSecure|qrCodeLogin|getProfile|verifyCertificate|createPinCode)\b/.exec(message)?.[1];
    const category = /Timeout|timed out|status=408/i.test(message)
      ? 'timeout'
      : /status=410/i.test(message)
        ? 'expired session'
        : /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(message)
          ? 'network failure'
          : 'LINE request failed';
    const details = [category, ...(status ? ['HTTP ' + status] : []), ...(method ? ['operation ' + method] : [])];

    return new BridgeError('LINE login failed while ' + stage + ' (' + details.join(', ') + '). ' +
      'Review the confirmation on the authorized phone before starting a fresh setup.');
  }
}
