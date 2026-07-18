frappe.ui.form.on('Barcode Template', {
    refresh: function(frm) {
        if (!window.TSCPrinter) {
            frappe.msgprint(__('TSCPrinter library not loaded. Please reload the page.'));
            return;
        }

        frm.trigger('setup_live_preview');
        frm.trigger('update_preview');
    },

    setup_live_preview: function(frm) {
        // Setup debounce mechanism
        if (!frm._debounce_timer) {
            frm._debounce_timer = null;
        }

        const trigger_update = () => {
            clearTimeout(frm._debounce_timer);
            frm._debounce_timer = setTimeout(() => {
                frm.trigger('update_preview');
            }, 800); // 800ms debounce
        };

        // Attach listeners to fields
        frm.fields_dict.raw_tspl.$input.on('input', trigger_update);
        frm.fields_dict.label_width.$input.on('input', trigger_update);
        frm.fields_dict.label_height.$input.on('input', trigger_update);
        frm.fields_dict.printer_language.$input.on('change', trigger_update);
    },

    update_preview: function(frm) {
        const wrapper = frm.fields_dict.preview_html && frm.fields_dict.preview_html.$wrapper;
        if (!wrapper) return;

        if (!frm.doc.raw_tspl) {
            wrapper.html('<p style="color:#aaa;padding:12px 0;">Enter raw code to see preview.</p>');
            return;
        }

        // Dummy context for Jinja variable substitution
        const dummy_context = {
            item_code: 'TEST-ITEM-01',
            item_name: 'Test Product Name',
            batch_id: 'BATCH-2026',
            manufacturing_date: frappe.datetime.get_today(),
            expiry_date: frappe.datetime.add_months(frappe.datetime.get_today(), 12),
            qty: 10,
            no_of_copies: 1
        };

        if (!wrapper.find('.tspl-preview-container').length) {
            wrapper.html(`
                <div style="
                    padding:16px;background:#f8f9fa;border-radius:8px;
                    border:2px dashed #dee2e6;display:flex;flex-direction:column;
                    align-items:center;min-height:220px;
                ">
                    <p style="font-size:11px;color:#6c757d;margin-bottom:12px;">Live Preview</p>
                    <div class="tspl-preview-container"></div>
                </div>
            `);
        }

        const container = wrapper.find('.tspl-preview-container')[0];
        
        // Use the centralized render engine we built earlier!
        if (window.TSCPrinter && typeof window.TSCPrinter.renderPreview === 'function') {
            window.TSCPrinter.renderPreview(container, frm.doc, dummy_context);
        }
    }
});
