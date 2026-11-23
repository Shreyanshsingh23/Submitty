// Throwaway spec for Submitty #13660 screenshots, not part of the PR.
// Setup steps are adapted from the image annotation spec in Submitty PR #13556.
import { buildUrl } from '../../support/utils';

const gradeable = 'bulk_upload_test';
const student = 'aphacker';
const variant = Cypress.expose('variant') || 'unknown';

const openDates = {
    ta_view_start_date: '1970-01-01 23:59:59',
    submission_open_date: '1971-01-01 23:59:59',
    submission_due_date: '1972-01-01 23:59:59',
    grade_start_date: '1973-01-01 23:59:59',
    grade_due_date: '1974-01-01 23:59:59',
    grade_released_date: '1974-01-01 23:59:59',
};

let gradeUrl;

function updateGradeable(body) {
    cy.visit(['sample', 'gradeable', gradeable, 'update']);
    cy.window().then((win) => {
        cy.request({
            method: 'POST',
            url: buildUrl(['sample', 'gradeable', gradeable, 'update']),
            form: true,
            body: { ...body, csrf_token: win.csrfToken },
        }).then((response) => {
            expect(JSON.parse(response.body).status).to.equal('success');
        });
    });
}

function showPanel(panelId) {
    cy.window().its('setPanelsVisibilities').should('be.a', 'function');
    cy.window().then((win) => win.setPanelsVisibilities(panelId, true));
    cy.get(`#${panelId}`).should('be.visible');
}

function openProcessedImage() {
    showPanel('submission_browser');
    cy.get('[data-folder-name="submissions_processed"] [id^="div_viewer_"]').first().then(($folder) => {
        if (!$folder.hasClass('open')) {
            cy.get('#submissions_processed').click();
        }
    });
    cy.intercept('POST', '**/grading/img').as('loadImage');
    cy.get('a.image-file.openable-element-submissions_processed').first().click();
    cy.wait('@loadImage');
    // Saved annotations replace the image with a marker view once it loads
    cy.get('#annotatable-image, #annotation-marker-view').should(($el) => {
        expect($el[0].id === 'annotation-marker-view' || $el[0].naturalWidth > 0).to.equal(true);
    });
}

function annotate() {
    cy.get('#add-annotations-btn').click();
    cy.get('#annotatable-image').then(($img) => {
        const state = {
            width: $img[0].naturalWidth,
            height: $img[0].naturalHeight,
            markers: [{
                typeName: 'FrameMarker',
                left: 50,
                top: 50,
                width: 100,
                height: 100,
                rotationAngle: 0,
                strokeColor: 'rgb(255,0,0)',
                strokeWidth: 10,
            }],
        };
        cy.get('#global-annotation-editor').trigger('editorsave', { detail: { state, dataUrl: 'data:,' }, force: true });
    });
    cy.get('#save-annotations-btn').click();
    cy.get('#annotation-status').should('have.text', 'Annotations saved successfully!');
}

function viewAsStudent(label) {
    cy.visit(['sample']);
    cy.login(student);
    cy.visit(['sample', 'gradeable', gradeable]);
    cy.get('[data-testid="ta-results-box"]').should('be.visible').scrollIntoView();
    cy.get('[data-testid="ta-results-box"]').invoke('prop', 'outerHTML').then((html) => {
        cy.writeFile(`cypress/screenshots/${variant}-${label}.html`, html);
    });
}

describe(`Submitty #13660 annotated feedback (${variant})`, () => {
    before(() => {
        cy.visit(['sample', 'gradeable', gradeable]);
        cy.login('instructor');
        updateGradeable(openDates);

        // Images in submissions_processed are only made for PDFs assigned through bulk upload
        cy.visit(['sample', 'gradeable', gradeable]);
        cy.get('[data-testid="radio-bulk-upload"]').click();
        cy.get('[data-testid="split-by-page-count"]').type('1');
        cy.get('[data-testid="select-files"]').selectFile('cypress/fixtures/bulk_upload.pdf', { force: true });
        cy.get('[data-testid="submit-gradeable"]').click();
        cy.get('[data-testid="assign-box"]').contains('2 files ready to assign', { timeout: 10000 });
        cy.reload();
        cy.intercept('POST', '**/verify').as('verifySubmitter');
        cy.intercept('POST', '**/split_pdf/upload?*').as('assignPdf');
        cy.get('[data-testid="bulk-user-id-1"]').type(student);
        cy.get('[data-testid="bulk-submit-1"]').click();
        cy.wait('@verifySubmitter').its('response.body').then((body) => {
            const response = typeof body === 'string' ? JSON.parse(body) : body;
            if (response.data.previous_submission) {
                cy.get('#previous-submission-form').should('be.visible').find('input[type="submit"]').click();
            }
        });
        cy.wait('@assignPdf');

        cy.visit(['sample', 'gradeable', gradeable, 'grading', 'details']);
        cy.get('[data-testid="view-sections"]').uncheck();
        cy.get('#details-table').contains('tr', student).find('[data-testid="grade-button"]').invoke('attr', 'href').then((href) => {
            gradeUrl = href;
        });

        // The page images are generated by a daemon job after the PDF is assigned
        cy.then(() => cy.visit(gradeUrl));
        // eslint-disable-next-line no-restricted-syntax
        cy.waitAndReloadUntil(() => {
            return cy.get('body').then(($body) => $body.find('a.image-file.openable-element-submissions_processed').length > 0);
        }, 60000, 2000);

        openProcessedImage();
        annotate();

        // Grade the only component so the student sees the TA results
        cy.then(() => cy.visit(gradeUrl));
        showPanel('grading_rubric');
        cy.get('[data-testid="component-container"]').first().click(20, 25);
        cy.get('[data-testid="save-tools-save"]', { timeout: 20000 }).should('contain', 'Save');
        cy.get('body').type('{0}');
        cy.intercept('POST', '**/graded_gradeable/graded_component').as('saveComponent');
        cy.get('[data-testid="save-tools-save"]').click();
        cy.wait('@saveComponent');
        cy.logout();
    });

    it('student download on', () => {
        cy.visit(['sample']);
        cy.login('instructor');
        updateGradeable({ student_download: 'true' });
        cy.logout();

        viewAsStudent('download-on');
        cy.get('[data-testid="ta-results-box"]').should('contain', 'Annotated Feedback');
        cy.get('[data-testid="ta-results-box"]').screenshot(`${variant}-1-download-on`);
        cy.logout();
    });

    it('student download off', () => {
        cy.visit(['sample']);
        cy.login('instructor');
        updateGradeable({ student_download: 'false' });
        cy.logout();

        viewAsStudent('download-off');
        cy.get('[data-testid="ta-results-box"]').screenshot(`${variant}-2-download-off`);
        cy.get('[data-testid="ta-results-box"]').then(($box) => {
            const shown = $box.text().includes('Annotated Feedback');
            cy.writeFile(`cypress/screenshots/${variant}-result.txt`, `annotated feedback shown with download off: ${shown}\n`, { flag: 'a+' });
            if (!shown) {
                return;
            }
            // Clicking View Popup shows the error from the issue in a browser alert
            const alerts = [];
            cy.on('window:alert', (text) => alerts.push(text));
            cy.contains('a', 'View Popup').click();
            cy.wrap(alerts, { timeout: 20000 }).should('have.length.greaterThan', 0).then(() => {
                cy.writeFile(`cypress/screenshots/${variant}-result.txt`, `alert after clicking View Popup: ${alerts[0]}\n`, { flag: 'a+' });
            });
        });
        if (variant === 'after') {
            cy.get('[data-testid="ta-results-box"]').should('not.contain', 'Annotated Feedback');
        }
        cy.logout();

        // Graders still see their own feedback tools, so check the instructor view is unaffected
        cy.visit(['sample']);
        cy.login('instructor');
        cy.then(() => cy.visit(gradeUrl));
        openProcessedImage();
        cy.get('#annotation-marker-view, #annotatable-image').should('exist');
        cy.screenshot(`${variant}-3-instructor-grading-download-off`, { capture: 'viewport' });
    });
});
