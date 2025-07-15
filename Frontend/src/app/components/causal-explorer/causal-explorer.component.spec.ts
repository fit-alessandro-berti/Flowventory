import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CausalExplorerComponent } from './causal-explorer.component';

describe('CausalExplorerComponent', () => {
  let component: CausalExplorerComponent;
  let fixture: ComponentFixture<CausalExplorerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CausalExplorerComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(CausalExplorerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
