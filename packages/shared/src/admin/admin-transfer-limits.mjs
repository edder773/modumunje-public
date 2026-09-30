const MEBIBYTE = 1024 * 1024;

// Keep the browser file budget below the full request budget because the
// parsed envelope is wrapped with the admin action and selection fields.
export const ADMIN_IMPORT_FILE_MAX_BYTES = 24 * MEBIBYTE;
export const ADMIN_REQUEST_MAX_BYTES = 25 * MEBIBYTE;

