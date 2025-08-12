import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VariantsExplorerComponent } from './variants-explorer.component';

describe('VariantsExplorerComponent', () => {
  let component: VariantsExplorerComponent;
  let fixture: ComponentFixture<VariantsExplorerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VariantsExplorerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(VariantsExplorerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
