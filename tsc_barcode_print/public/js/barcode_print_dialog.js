// ─────────────────────────────────────────────────────────────────────────────
// barcode_print_dialog.js
// Attached to Purchase Receipt & Stock Entry via hooks.py
// ─────────────────────────────────────────────────────────────────────────────

// ── Entry point ───────────────────────────────────────────────────────────────

function inject_barcode_print_button(frm) {
    // Show for submitted docs only (not cancelled)
    if (frm.doc.docstatus !== 1) return;

    frm.add_custom_button(__('Print Barcodes'), () => {
        open_barcode_print_dialog(frm);
    }, __('Actions'));
}

// ── JsBarcode lazy loader ─────────────────────────────────────────────────────

function load_js_barcode() {
    return new Promise((resolve) => {
        if (window.JsBarcode) { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js';
        s.onload = resolve;
        document.head.appendChild(s);
    });
}

// ── Main dialog opener ────────────────────────────────────────────────────────

function open_barcode_print_dialog(frm) {
    if (!frm.doc.items || frm.doc.items.length === 0) {
        frappe.msgprint(__('No items found in this document.'));
        return;
    }

    frappe.show_progress(__('Loading…'), 0, 100, __('Fetching templates, printers & items'));

    // Run all async operations in parallel
    const templates_p = frappe.call({
        method: 'frappe.client.get_list',
        args: { doctype: 'Barcode Template', fields: ['name'], limit_page_length: 0 }
    });

    const printers_p = new Promise((resolve, reject) => {
        if (!window.TSCPrinter) { reject('QZ Tray script not loaded'); return; }
        window.TSCPrinter.loadQz(() => {
            const isActive = typeof qz !== 'undefined' && qz.websocket.isActive();
            const connect  = isActive ? Promise.resolve() : qz.websocket.connect();
            connect.then(() => qz.printers.find()).then(resolve).catch(reject);
        });
    });

    const items_p = frappe.call({
        method: 'tsc_barcode_print.api.get_items_for_barcode_print',
        args: { doctype: frm.doc.doctype, docname: frm.doc.name }
    });

    Promise.all([templates_p, printers_p, items_p, load_js_barcode()])
        .then(([tpl_res, printers, items_res]) => {
            frappe.hide_progress();

            const templates    = (tpl_res.message  || []).map(d => d.name);
            const dialog_items = items_res.message  || [];

            if (!templates.length) {
                frappe.msgprint(__('No Barcode Templates found. Please create one first.'));
                return;
            }
            if (!printers || !printers.length) {
                frappe.msgprint(__('No printers detected by QZ Tray. Ensure QZ Tray is running and printers are installed.'));
                return;
            }
            if (!dialog_items.length) {
                frappe.msgprint(__('No printable items could be resolved from this document.'));
                return;
            }

            // Pre-fetch the first template doc so preview renders immediately
            frappe.db.get_doc('Barcode Template', templates[0]).then(first_tpl => {
                create_dialog(frm, templates, printers, first_tpl, dialog_items);
            });
        })
        .catch(err => {
            frappe.hide_progress();
            console.error('Barcode print dialog error:', err);
            frappe.msgprint(
                __('Could not initialise print dialog: {0}. Ensure QZ Tray is running.', [String(err)])
            );
        });
}

// ── Dialog builder ────────────────────────────────────────────────────────────

function create_dialog(frm, templates, printers, initial_template, dialog_items) {

    const d = new frappe.ui.Dialog({
        title:  __('Print Barcodes — {0}', [frm.doc.name]),
        size:   'extra-large',
        fields: [
            // ─── Top bar: template + printer side by side ───
            {
                fieldname: 'template',
                label:     __('Barcode Template'),
                fieldtype: 'Select',
                options:   templates.join('\n'),
                default:   initial_template.name,
                reqd:      1,
                onchange() {
                    const val = d.get_value('template');
                    if (!val) return;
                    frappe.db.get_doc('Barcode Template', val).then(tpl => {
                        d._template_doc = tpl;
                        update_preview();
                    });
                }
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
            // ─── Items grid + preview ───
            { fieldtype: 'Section Break', label: __('Items') },
            {
                fieldname:       'items',
                label:           __('Items to Print'),
                fieldtype:       'Table',
                reqd:            1,
                cannot_add_rows: true,
                in_place_edit:   true,
                data:            dialog_items,
                fields: [
                    { fieldname: 'item_code',    fieldtype: 'Link',  options: 'Item', in_list_view: 1, label: __('Item Code'),    read_only: 1, columns: 3 },
                    { fieldname: 'batch_no',     fieldtype: 'Data',  in_list_view: 1, label: __('Batch No'),      columns: 2 },
                    { fieldname: 'mfg_date',     fieldtype: 'Date',  in_list_view: 1, label: __('Mfg Date'),      columns: 2 },
                    { fieldname: 'label_qty',    fieldtype: 'Float', in_list_view: 1, label: __('Label Qty'),     columns: 2 },
                    { fieldname: 'no_of_copies', fieldtype: 'Int',   in_list_view: 1, label: __('Copies'),        columns: 2 }
                ]
            },
            { fieldtype: 'Column Break' },
            {
                fieldname: 'preview_html',
                fieldtype: 'HTML'
            }
        ],
        primary_action_label: __('🖨 Print All'),
        primary_action(values) {
            const items = values.items || [];
            if (!items.length) { frappe.msgprint(__('No items to print.')); return; }

            // Warn if copies are suspiciously high
            const warnings = items.filter(r => r.no_of_copies > 0 && r.no_of_copies > r.label_qty * 2)
                                  .map(r => `${r.item_code} (Copies: ${r.no_of_copies}, Qty: ${r.label_qty})`);

            const do_print = () => {
                d.get_primary_btn().prop('disabled', true).text(__('Printing…'));
                print_sequential(values, items, 0, d);
            };

            if (warnings.length) {
                frappe.confirm(
                    __('Warning: significantly more copies than quantities for:<br><b>{0}</b><br><br>Proceed?',
                       [warnings.join('<br>')]),
                    do_print
                );
            } else {
                do_print();
            }
        }
    });

    // Store template doc on the dialog object for preview helper
    d._template_doc = initial_template;

    // ── Preview helpers ────────────────────────────────────────────────────────

    function get_active_row() {
        const grid = d.fields_dict.items.grid;
        const active_name = grid.wrapper.find('.grid-row-active').attr('data-name');
        if (active_name) return grid.get_docrow(active_name);
        if (grid.grid_rows && grid.grid_rows.length > 0) return grid.grid_rows[0].doc;
        return null;
    }

    function update_preview(row) {
        row = row || get_active_row();
        if (!row || !d._template_doc) return;

        const $w = d.fields_dict.preview_html.$wrapper;
        if (!$w.find('.tspl-preview-container').length) {
            $w.html(`
                <div style="
                    padding:16px;background:#f8f9fa;border-radius:8px;
                    border:2px dashed #dee2e6;display:flex;flex-direction:column;
                    align-items:center;min-height:220px;
                ">
                    <p style="font-size:11px;color:#6c757d;margin-bottom:12px;">Live Preview (selected row)</p>
                    <div class="tspl-preview-container"></div>
                </div>
            `);
        }

        const context = {
            item_code:          row.item_code  || '',
            item_name:          row.item_name  || row.item_code || '',
            batch_id:           row.batch_no   || '',
            manufacturing_date: row.mfg_date   || '',
            qty:                row.label_qty  || 1.0,
            no_of_copies:       row.no_of_copies || 1
        };

        if (window.TSCPrinter && typeof window.TSCPrinter.renderPreview === 'function') {
            window.TSCPrinter.renderPreview($w.find('.tspl-preview-container')[0], d._template_doc, context);
        }
    }

    // ── Event bindings ────────────────────────────────────────────────────────

    const grid_wrapper = d.fields_dict.items.grid.wrapper;

    grid_wrapper.on('click', '.grid-row', function() {
        const row = d.fields_dict.items.grid.get_docrow($(this).attr('data-name'));
        if (row) update_preview(row);
    });

    grid_wrapper.on('change input', 'input,select', function() {
        const name = $(this).closest('.grid-row').attr('data-name');
        if (!name) return;
        setTimeout(() => {
            const row = d.fields_dict.items.grid.get_docrow(name);
            if (row) update_preview(row);
        }, 150);
    });

    // ── Show dialog and initial preview ──────────────────────────────────────
    d.show();
    setTimeout(() => update_preview(), 400);
}

// ── Sequential printing helper ────────────────────────────────────────────────

function print_sequential(values, items, index, dialog) {
    if (index >= items.length) {
        dialog.hide();
        frappe.show_alert({ message: __('All labels sent to printer ✓'), indicator: 'green' }, 5);
        return;
    }

    const row = items[index];
    if (!row.no_of_copies || !row.item_code) {
        print_sequential(values, items, index + 1, dialog);
        return;
    }

    window.TSCPrinter.printTSPL(
        values.template,
        row.item_code,
        row.batch_no,
        row.mfg_date,
        row.label_qty,
        row.no_of_copies,
        values.printer
    ).then(() => {
        print_sequential(values, items, index + 1, dialog);
    }).catch(err => {
        dialog.get_primary_btn().prop('disabled', false).text(__('🖨 Print All'));
        frappe.msgprint(__('Print error on item {0}: {1}', [row.item_code, String(err)]));
    });
}



// ── Bind to doctypes ──────────────────────────────────────────────────────────

frappe.ui.form.on('Purchase Receipt', {
    refresh: (frm) => inject_barcode_print_button(frm)
});

frappe.ui.form.on('Stock Entry', {
    refresh: (frm) => inject_barcode_print_button(frm)
});
