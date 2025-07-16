import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { NavigationComponent } from './components/navigation/navigation.component';
import { EventsTableComponent } from './components/events-table/events-table.component';
import { SaOcdfgComponent } from './components/sa-ocdfg/sa-ocdfg.component';
import { CausalExplorerComponent } from './components/causal-explorer/causal-explorer.component';
import { LifecyclePatternsComponent } from './components/lifecycle-patterns/lifecycle-patterns.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    NavigationComponent,
    EventsTableComponent,
    SaOcdfgComponent,
    CausalExplorerComponent,
    LifecyclePatternsComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'Frontend';
  currentView = 'events';

  onNavigationChange(view: string): void {
    this.currentView = view;
  }
}
