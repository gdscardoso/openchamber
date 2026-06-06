import React from 'react';
import { GitHubIssuePickerDialog } from '@/components/session/GitHubIssuePickerDialog';

export function IssuePickerDialog(props: React.ComponentProps<typeof GitHubIssuePickerDialog>) {
  return <GitHubIssuePickerDialog {...props} />;
}
