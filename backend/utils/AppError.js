// Thrown deliberately inside a controller for a condition the CALLER should
// see verbatim -- "Bill not found", "Invoice already fully paid", and so on.
// Every controller's catch block checks `err instanceof AppError` and, if
// so, sends err.message straight through (that's the whole point of these
// messages -- the frontend displays them to the user). Anything that is NOT
// an AppError -- a real bug, a DB hiccup, a Mongoose internal error whose
// message can contain field paths or raw values -- falls through to a
// generic message instead, so those internals never reach the client.
class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

module.exports = AppError;
