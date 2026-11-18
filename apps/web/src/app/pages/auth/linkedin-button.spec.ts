import { linkedInProblem, readAuthError } from './linkedin-button';

const from = (query: string) => new URLSearchParams(query);

describe('linkedInProblem', () => {
  it('says nothing when the address carries no error', () => {
    expect(linkedInProblem(from('next=%2Fjobs'))).toBeNull();
  });

  it('explains the invite rule when the database refused a new account', () => {
    const text = linkedInProblem(
      from(
        'error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user',
      ),
    );
    expect(text).toContain('invite code');
    expect(text).toContain('Create an account');
  });

  it('is calm about a sign-in the person left', () => {
    expect(
      linkedInProblem(
        from(
          'error=user_cancelled_login&error_description=The+user+cancelled+LinkedIn+login',
        ),
      ),
    ).toContain('nothing changed');
    expect(linkedInProblem(from('error=access_denied'))).toContain(
      'nothing changed',
    );
  });

  it('tells a suspended account so, however it was refused', () => {
    for (const error of ['access_denied', 'server_error'])
      expect(
        linkedInProblem(
          from(
            `error=${error}&error_code=user_banned&error_description=User+is+banned`,
          ),
        ),
      ).toContain('suspended');
  });

  it('points at the email address when LinkedIn has not confirmed it', () => {
    expect(
      linkedInProblem(
        from(
          'error_code=provider_email_needs_verification&error_description=Unverified+email+with+linkedin_oidc',
        ),
      ),
    ).toContain('not confirmed');
  });

  it('never shows the server wording for anything else', () => {
    const text = linkedInProblem(
      from(
        'error=server_error&error_description=Unable+to+exchange+external+code',
      ),
    );
    expect(text).toContain('did not work this time');
    expect(text).not.toContain('exchange');
  });
});

describe('readAuthError', () => {
  it('reads the part after # when the query has nothing', () => {
    expect(
      readAuthError(
        from(''),
        'error=server_error&error_description=Database+error+saving+new+user',
      ),
    ).toContain('invite code');
    expect(readAuthError(from(''), null)).toBeNull();
    expect(readAuthError(from(''), 'access_token=abc')).toBeNull();
  });
});
