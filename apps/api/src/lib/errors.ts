export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Eintrag') => new HttpError(404, 'not_found', `${what} wurde nicht gefunden.`);
export const badRequest = (message: string, code = 'bad_request') => new HttpError(400, code, message);
export const forbidden = () => new HttpError(403, 'forbidden', 'Dafür fehlen Ihnen die Rechte.');
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
