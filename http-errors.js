function httpStatusForError(error) {
  const status = Number(error?.statusCode || error?.status || 0);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

module.exports = { httpStatusForError };
