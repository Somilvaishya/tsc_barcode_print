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
                <div class="barcode-preview-wrapper" style="margin-top: -5px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
                        <div style="font-weight: 600; font-size: 13px; color: #1f272e;">
                            <i class="fa fa-image text-muted" style="margin-right: 4px;"></i> Live Preview
                        </div>
                        <div style="font-size: 11px; color: #007bff; background: #e6f2ff; padding: 3px 8px; border-radius: 12px; font-weight: 500;">
                            <i class="fa fa-bolt" style="margin-right:3px;"></i> Auto-updating
                        </div>
                    </div>
                    <div class="preview-canvas" style="
                        background-color: #e2e8f0;
                        background-image: linear-gradient(45deg, #cbd5e1 25%, transparent 25%, transparent 75%, #cbd5e1 75%, #cbd5e1), linear-gradient(45deg, #cbd5e1 25%, transparent 25%, transparent 75%, #cbd5e1 75%, #cbd5e1);
                        background-size: 20px 20px;
                        background-position: 0 0, 10px 10px;
                        border: 1px solid #ced4da;
                        border-radius: 8px;
                        padding: 30px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 320px;
                        overflow: auto;
                        box-shadow: inset 0 2px 4px rgba(0,0,0,0.06);
                    ">
                        <div class="tspl-preview-container" style="transition: all 0.3s ease;"></div>
                    </div>
                </div>
            `);
            
            // Adjust the raw code textarea height to match the preview height nicely
            setTimeout(() => {
                let $textarea = frm.fields_dict.raw_tspl.$input;
                if ($textarea) {
                    $textarea.css({'min-height': '350px', 'font-family': 'monospace', 'line-height': '1.5'});
                }
            }, 100);
        }

        const container = wrapper.find('.tspl-preview-container')[0];
        
        // Use the centralized render engine we built earlier!
        if (window.TSCPrinter && typeof window.TSCPrinter.renderPreview === 'function') {
            window.TSCPrinter.renderPreview(container, frm.doc, dummy_context);
        }
    }
});
