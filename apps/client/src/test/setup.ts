import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sans les globals de Vitest, Testing Library ne démonte pas tout seul ce qu'un test a rendu : on le fait ici.
afterEach(() => {
  cleanup();
});
