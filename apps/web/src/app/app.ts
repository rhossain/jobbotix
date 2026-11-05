import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { Auth } from './core/auth';
import { Shortcuts } from './core/shortcuts';
import { Theme } from './core/theme';
import { Toast } from './shared/toast';

@Component({
  imports: [RouterModule],
  selector: 'jb-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly auth = inject(Auth);
  protected readonly toast = inject(Toast);
  private readonly router = inject(Router);
  protected readonly title = 'Jobbotix';
  protected readonly shortcuts = inject(Shortcuts);
  protected readonly theme = inject(Theme);

  constructor() {
    this.shortcuts.install();
  }

  async signOut() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
