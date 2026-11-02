import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { Auth } from './core/auth';

@Component({
  imports: [RouterModule],
  selector: 'jb-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly auth = inject(Auth);
  private readonly router = inject(Router);
  protected readonly title = 'Jobbotix';

  async signOut() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
