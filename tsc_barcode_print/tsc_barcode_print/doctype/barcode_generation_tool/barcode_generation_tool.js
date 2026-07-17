// ─────────────────────────────────────────────────────────────────────────────
// Barcode Generation Tool – Client Controller
// ─────────────────────────────────────────────────────────────────────────────

frappe.ui.form.on('Barcode Generation Tool', {

    // ── Lifecycle ────────────────────────────────────────────────────────────

    onload(frm) {
        // Filter existing_batch to only batches belonging to the selected item
        frm.set_query('existing_batch', () => ({
            filters: { item: frm.doc.item_code }
        }));

        // Auto-populate Target Printer dropdown from QZ Tray on load
        // (stored temporarily on frm for dialog default)
        prefetch_printers(frm);
    },

    refresh(frm) {
        update_mode_visibility(frm);

        // Live preview on the form (only in draft)
        if (frm.doc.docstatus === 0) {
            update_form_preview(frm);
        } else {
            frm.fields_dict.preview_html.$wrapper.html('');
        }

        // Print button shown on submitted docs
        if (frm.doc.docstatus === 1) {
            frm.add_custom_button(__('Print Barcode'), () => {
                open_print_dialog(frm);
            }).addClass('btn-primary');
        }
    },

    // ── Field Triggers ───────────────────────────────────────────────────────

    mode(frm) {
        update_mode_visibility(frm);
        if (frm.doc.mode === 'New Pre-Batch') {
            frm.set_value('existing_batch', '');
        } else {
            frm.set_value('batch_no', '');
        }
        update_form_preview(frm);
    },

    item_code(frm) {
        frm.set_value('existing_batch', '');
        frm.set_value('batch_no', '');
        update_form_preview(frm);
    },

    batch_no(frm)           { update_form_preview(frm); },
    manufacturing_date(frm) { update_form_preview(frm); },
    label_qty(frm)          { update_form_preview(frm); },
    barcode_symbology(frm)  { update_form_preview(frm); },

    existing_batch(frm) {
        if (frm.doc.existing_batch) {
            frappe.db.get_value('Batch', frm.doc.existing_batch,
                ['manufacturing_date', 'expiry_date'],
                (r) => {
                    if (r) {
                        if (r.manufacturing_date) frm.set_value('manufacturing_date', r.manufacturing_date);
                        if (r.expiry_date)        frm.set_value('expiry_date',         r.expiry_date);
                        update_form_preview(frm);
                    }
                }
            );
        } else {
            frm.set_value('manufacturing_date', '');
            frm.set_value('expiry_date', '');
            update_form_preview(frm);
        }
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers – Field visibility
// ─────────────────────────────────────────────────────────────────────────────

function update_mode_visibility(frm) {
    const is_new = frm.doc.mode === 'New Pre-Batch';
    frm.set_df_property('batch_no',       'hidden', is_new ? 0 : 1);
    frm.set_df_property('existing_batch', 'hidden', is_new ? 1 : 0);
    frm.refresh_fields(['batch_no', 'existing_batch']);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers – Pre-fetch printers silently (cached on frm._printers)
// ─────────────────────────────────────────────────────────────────────────────

function prefetch_printers(frm) {
    let attempt = 0;
    const MAX = 20;

    const try_load = () => {
        attempt++;
        if (window.TSCPrinter && typeof window.TSCPrinter.loadQz === 'function') {
            window.TSCPrinter.loadQz(() => {
                const isActive = typeof qz !== 'undefined' && qz.websocket.isActive();
                const connect  = isActive ? Promise.resolve() : qz.websocket.connect();
                connect.then(() => qz.printers.find())
                       .then(p => { frm._printers = p || []; })
                       .catch(() => { frm._printers = []; });
            });
        } else if (attempt < MAX) {
            setTimeout(try_load, 500);
        }
    };

    try_load();
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers – Live preview on the form
// ─────────────────────────────────────────────────────────────────────────────

function update_form_preview(frm) {
    const wrapper = frm.fields_dict.preview_html && frm.fields_dict.preview_html.$wrapper;
    if (!wrapper) return;

    // Need at least a template to preview — fetch the first available template
    frappe.call({
        method: 'frappe.client.get_list',
        args: { doctype: 'Barcode Template', fields: ['name'], limit_page_length: 1 },
        callback(r) {
            const templates = (r.message || []).map(d => d.name);
            if (!templates.length) {
                wrapper.html('<p style="color:#aaa;padding:12px 0;">No Barcode Templates found.</p>');
                return;
            }
            const tpl_name = frm._last_preview_template || templates[0];
            frappe.db.get_doc('Barcode Template', tpl_name)
                .then(tpl => render_into(wrapper, tpl, build_context(frm, 1)))
                .catch(() => wrapper.html('<p style="color:#e74c3c;padding:12px 0;">Could not load template preview.</p>'));
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers – Print dialog (opened after submission)
// ─────────────────────────────────────────────────────────────────────────────

function open_print_dialog(frm) {
    const batch = frm.doc.mode === 'New Pre-Batch' ? frm.doc.batch_no : frm.doc.existing_batch;
    if (!frm.doc.item_code || !batch) {
        frappe.msgprint(__('Please fill Item Code and Batch before printing.'));
        return;
    }

    frappe.show_progress(__('Loading…'), 0, 100, __('Fetching templates & printers'));

    const templates_p = frappe.call({
        method: 'frappe.client.get_list',
        args: { doctype: 'Barcode Template', fields: ['name'], limit_page_length: 0 }
    });

    const printers_p = frm._printers && frm._printers.length > 0
        ? Promise.resolve(frm._printers)
        : new Promise((resolve, reject) => {
            if (!window.TSCPrinter) { reject('QZ Tray not loaded'); return; }
            window.TSCPrinter.loadQz(() => {
                const isActive = typeof qz !== 'undefined' && qz.websocket.isActive();
                const connect  = isActive ? Promise.resolve() : qz.websocket.connect();
                connect.then(() => qz.printers.find()).then(resolve).catch(reject);
            });
        });

    Promise.all([templates_p, printers_p])
        .then(([tpl_res, printers]) => {
            frappe.hide_progress();
            const templates = (tpl_res.message || []).map(d => d.name);
            if (!templates.length) {
                frappe.msgprint(__('No Barcode Templates found. Please create one first.'));
                return;
            }
            if (!printers || !printers.length) {
                frappe.msgprint(__('No printers found in QZ Tray. Ensure QZ Tray is running.'));
                return;
            }
            show_print_dialog(frm, templates, printers);
        })
        .catch(err => {
            frappe.hide_progress();
            console.error(err);
            frappe.msgprint(__('Could not connect to QZ Tray. Ensure it is running on this machine.'));
        });
}

function show_print_dialog(frm, templates, printers) {
    const d = new frappe.ui.Dialog({
        title: __('Print Barcode Label'),
        size:  'large',
        fields: [
            {
                fieldname: 'template',
                label:     __('Barcode Template'),
                fieldtype: 'Select',
                options:   templates.join('\n'),
                default:   frm._last_preview_template || templates[0],
                reqd:      1,
                onchange() { refresh_dialog_preview(); }
            },
            { fieldtype: 'Column Break' },
            {
                fieldname: 'printer',
                label:     __('Target Printer'),
                fieldtype: 'Select',
                options:   printers.join('\n'),
                default:   printers[0],
                reqd:      1
            },
            { fieldtype: 'Column Break' },
            {
                fieldname: 'no_of_copies',
                label:     __('No. of Copies'),
                fieldtype: 'Int',
                default:   1,
                reqd:      1
            },
            { fieldtype: 'Section Break', label: __('Preview') },
            {
                fieldname: 'preview_html',
                fieldtype: 'HTML'
            }
        ],
        primary_action_label: __('🖨  Print'),
        primary_action(values) {
            d.hide();
            frm._last_preview_template = values.template;
            const batch = frm.doc.mode === 'New Pre-Batch' ? frm.doc.batch_no : frm.doc.existing_batch;
            window.TSCPrinter.printTSPL(
                values.template,
                frm.doc.item_code,
                batch,
                frm.doc.manufacturing_date,
                frm.doc.label_qty,
                values.no_of_copies,   // ← taken from dialog now
                values.printer
            );
        }
    });

    const refresh_dialog_preview = () => {
        const tpl_name = d.get_value('template');
        if (!tpl_name) return;
        frappe.db.get_doc('Barcode Template', tpl_name).then(tpl => {
            if (!tpl) return;
            const wrapper = d.fields_dict.preview_html.$wrapper;
            render_into(wrapper, tpl, build_context(frm, d.get_value('no_of_copies') || 1));
        });
    };

    d.show();
    setTimeout(refresh_dialog_preview, 200);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────────────────────────────────────

function build_context(frm, copies) {
    const batch = frm.doc.mode === 'New Pre-Batch' ? frm.doc.batch_no : frm.doc.existing_batch;
    return {
        item_code:          frm.doc.item_code          || '',
        item_name:          frm.doc.item_name          || frm.doc.item_code || '',
        batch_id:           batch                      || '',
        manufacturing_date: frm.doc.manufacturing_date || '',
        expiry_date:        frm.doc.expiry_date        || '',
        qty:                frm.doc.label_qty          || 1.0,
        no_of_copies:       copies                     || 1
    };
}

function render_into(wrapper, template_doc, context) {
    if (!wrapper) return;
    if (!wrapper.find('.tspl-preview-container').length) {
        wrapper.html(`
            <div style="
                padding:16px;background:#f8f9fa;border-radius:8px;
                border:2px dashed #dee2e6;display:flex;flex-direction:column;
                align-items:center;min-height:180px;margin-top:8px;
            ">
                <p style="font-size:11px;color:#6c757d;margin-bottom:12px;">Live Preview</p>
                <div class="tspl-preview-container"></div>
            </div>
        `);
    }
    const container = wrapper.find('.tspl-preview-container')[0];
    if (window.TSCPrinter && typeof window.TSCPrinter.renderPreview === 'function') {
        window.TSCPrinter.renderPreview(container, template_doc, context);
    }
}
