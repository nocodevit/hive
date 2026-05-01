// Loaded once before any test file. Adds jest-dom matchers
// (toBeInTheDocument, toHaveStyle, etc.) onto vitest's `expect`.
// No-op for node-environment tests because matchers don't fire there.
import '@testing-library/jest-dom/vitest'
