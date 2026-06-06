import React from 'react';
import { GitHubPrPickerDialog } from '@/components/session/GitHubPrPickerDialog';

export function PrPickerDialog(props: React.ComponentProps<typeof GitHubPrPickerDialog>) {
  return <GitHubPrPickerDialog {...props} />;
}
