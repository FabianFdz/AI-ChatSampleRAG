# E6: Document Upload UI

## Goal
User-facing interface for initializing sessions and uploading knowledge base documents.

## Scope
Document upload interface:
- File input component for PDF uploads
- Text area for pasting content directly
- Display of uploaded documents (list, metadata)
- File type and size validation (client-side)
- Upload progress indicator and status feedback
- Error messaging for failed uploads
- Session initialization and management
- Clear/reset session button

## Depends on
E4 (Backend API Endpoints), E5 (Frontend Setup)

## Priority
must-have

## To settle
- Drag-and-drop support?
- Preview of document content before upload?
- Batch upload or one-at-a-time?
- File deletion/removal from session?

---

## Acceptance Criteria
- [ ] Users can upload PDF files
- [ ] Users can paste plain text content
- [ ] UI displays uploaded documents
- [ ] Prevents upload of >3 files (enforced)
- [ ] Upload errors show helpful messages
- [ ] Progress bar visible during upload
- [ ] Session creation works before upload

## Notes
First user touchpoint. Quality impacts user experience significantly.
