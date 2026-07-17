// Public JS for TSC Barcode Print via QZ Tray
// Multi-user safe: each browser session has its own TSCPrinter instance.
// QZ Tray handles job queuing independently per printer — no cross-user conflicts.

var TSCPrinter = {
    qzLoaded:    false,
    _printing:   false,   // Per-session print lock — prevents double-click double-print

    loadQz: function(callback) {
        if (window.qz) {
            // QZ already loaded — just ensure security is configured
            this._setup_qz_security();
            if (callback) callback();
            return;
        }

        // Dynamically load qz-tray.js from CDN
        var script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.min.js";
        script.onload = () => {
            this.qzLoaded = true;
            // Configure certificate auth BEFORE any connection attempt
            this._setup_qz_security();
            if (callback) callback();
        };
        document.head.appendChild(script);
    },

    // ── Certificate-based auth — eliminates "Untrusted Website" popup ─────────
    _setup_qz_security: function() {
        if (this._security_configured) return;
        this._security_configured = true;

        // 1. Provide our public certificate to QZ Tray
        qz.security.setCertificatePromise(function(resolve, reject) {
            frappe.call({
                method:   'tsc_barcode_print.api.get_qz_certificate',
                callback: function(r) { resolve(r.message || ''); },
                error:    function()  { resolve(''); }  // fallback: show popup
            });
        });

        // 2. Sign every QZ authentication challenge with our private key (server-side)
        qz.security.setSignatureAlgorithm('SHA512');
        qz.security.setSignaturePromise(function(toSign) {
            return function(resolve, reject) {
                frappe.call({
                    method:   'tsc_barcode_print.api.sign_qz_message',
                    args:     { message: toSign },
                    callback: function(r) { resolve(r.message || ''); },
                    error:    function(e) { reject(e); }
                });
            };
        });
    },
    // ─────────────────────────────────────────────────────────────────────────

    loadJsBarcode: function(callback) {
        if (window.JsBarcode) {
            if(callback) callback();
            return;
        }
        var script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js";
        script.onload = () => {
            if(callback) callback();
        };
        document.head.appendChild(script);
    },

    connect: function(host, port) {
        console.log("TSCPrinter.connect called. host:", host, "port:", port);
        return new Promise((resolve, reject) => {
            if (qz.websocket.isActive()) {
                console.log("QZ WebSocket is already active.");
                resolve();
            } else {
                let options = { host: host || "localhost" };
                console.log("Calling qz.websocket.connect with options:", JSON.stringify(options));
                qz.websocket.connect(options).then(() => {
                    console.log("QZ WebSocket connection successful.");
                    resolve();
                }).catch((err) => {
                    console.error("QZ WebSocket connection failed:", err);
                    reject(err);
                });
            }
        });
    },

    printTSPL: function(template_name, item_code, batch_id, mfg_date, label_qty, no_of_copies, printer_name = null) {
        return new Promise((resolve, reject) => {

            // ── Per-session double-click guard ────────────────────────────────
            if (this._printing) {
                frappe.show_alert({ message: __('Print already in progress, please wait…'), indicator: 'orange' }, 4);
                return reject('Print already in progress');
            }
            this._printing = true;
            const release_lock = () => { this._printing = false; };

            this.loadQz(() => {
                // Resolve printer: use explicitly passed name, else fall back to default
                let get_printer = printer_name
                    ? Promise.resolve(printer_name)
                    : qz.printers.getDefault().then(p => p || qz.printers.find().then(all => all[0]));

                get_printer.then(active_printer => {
                    if (!active_printer) {
                        release_lock();
                        frappe.msgprint(__('No printer selected or found. Please select a printer.'));
                        return reject('No printer');
                    }

                    // Connect to QZ Tray (localhost — QZ runs on THIS machine/session)
                    this.connect('localhost').then(() => {

                        // Fetch rendered TSPL from server
                        frappe.call({
                            method: 'tsc_barcode_print.api.render_barcode_template',
                            args: {
                                template_name: template_name,
                                item_code:     item_code,
                                batch_id:      batch_id,
                                mfg_date:      mfg_date,
                                label_qty:     label_qty,
                                no_of_copies:  no_of_copies
                            },
                            callback: (tspl_res) => {
                                if (!tspl_res.message || !tspl_res.message.tspl) {
                                    release_lock();
                                    return reject('Empty TSPL response');
                                }

                                let config = qz.configs.create(active_printer);
                                let data   = tspl_res.message.tspl;

                                qz.print(config, data).then(() => {
                                    release_lock();
                                    frappe.show_alert({ message: __('✓ Printed to {0}', [active_printer]), indicator: 'green' }, 5);

                                    // ── Audit log (fire-and-forget, non-blocking) ─────
                                    let source_dt = window.cur_frm ? window.cur_frm.doctype  : null;
                                    let source_dn = window.cur_frm ? window.cur_frm.docname  : null;

                                    frappe.call({
                                        method: 'tsc_barcode_print.api.log_barcode_print',
                                        args: {
                                            template:        template_name,
                                            printer_profile: active_printer,
                                            item_code:       item_code,
                                            batch_no:        batch_id,
                                            label_qty:       label_qty,
                                            no_of_copies:    no_of_copies,
                                            source_doctype:  source_dt,
                                            source_docname:  source_dn
                                        }
                                    });
                                    // ─────────────────────────────────────────────────

                                    resolve();

                                }).catch((err) => {
                                    release_lock();
                                    frappe.msgprint(__('Print Error: {0}', [String(err)]));
                                    reject(err);
                                });
                            },
                            error: (err) => {
                                release_lock();
                                frappe.msgprint(__('Server error rendering template: {0}', [String(err)]));
                                reject(err);
                            }
                        });

                    }).catch((err) => {
                        release_lock();
                        frappe.msgprint(__(
                            'Cannot connect to QZ Tray on this machine.<br>' +
                            '<b>Ensure QZ Tray is running on this computer.</b><br><small>{0}</small>', [String(err)]
                        ));
                        reject(err);
                    });

                }).catch((err) => {
                    release_lock();
                    frappe.msgprint(__('Error resolving printer: {0}', [String(err)]));
                    reject(err);
                });
            });
        });
    },

    renderPreview: function(container, template_doc, context) {
        this.loadJsBarcode(() => {
            container.innerHTML = "";
            
            // Scale mm to pixels (e.g. 1mm = 4.5px) for display
            let scale = 4.5;
            let width_mm = template_doc.label_width || 50;
            let height_mm = template_doc.label_height || 30;
            
            let width_px = width_mm * scale;
            let height_px = height_mm * scale;
            
            container.style.width = width_px + "px";
            container.style.height = height_px + "px";
            container.style.position = "relative";
            container.style.border = "1px solid #333";
            container.style.backgroundColor = "#fff";
            container.style.boxShadow = "0 6px 12px rgba(0,0,0,0.15)";
            container.style.margin = "0 auto";
            container.style.overflow = "hidden";

            // Substitute context in TSPL lines
            let substituted = template_doc.raw_tspl || "";
            for (let key in context) {
                let val = context[key] !== undefined && context[key] !== null ? context[key] : "";
                let regex = new RegExp("{{\\s*" + key + "\\s*}}", "g");
                substituted = substituted.replace(regex, val);
            }
            
            let lines = substituted.split("\n");
            lines.forEach(line => {
                line = line.trim();
                if (line.startsWith("TEXT")) {
                    // Format: TEXT x,y,"font",rotation,x_mul,y_mul,"content"
                    let match = line.match(/TEXT\s+(\d+)\s*,\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*"([^"]*)"/);
                    if (match) {
                        let x_mm = parseFloat(match[1]) / 8;
                        let y_mm = parseFloat(match[2]) / 8;
                        
                        let left_px = x_mm * scale;
                        let top_px = y_mm * scale;
                        let text = match[7];
                        
                        let el = document.createElement("div");
                        el.style.position = "absolute";
                        el.style.left = left_px + "px";
                        el.style.top = top_px + "px";
                        el.style.fontFamily = "monospace";
                        el.style.fontSize = "12px";
                        el.style.fontWeight = "bold";
                        el.style.color = "#000";
                        el.style.lineHeight = "1";
                        el.style.whiteSpace = "nowrap";
                        el.innerText = text;
                        
                        container.appendChild(el);
                    }
                } else if (line.startsWith("BAR ")) {
                    // Format: BAR x,y,width,height
                    let match = line.match(/BAR\s+(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
                    if (match) {
                        let x_mm = parseFloat(match[1]) / 8;
                        let y_mm = parseFloat(match[2]) / 8;
                        let w_mm = parseFloat(match[3]) / 8;
                        let h_mm = parseFloat(match[4]) / 8;
                        
                        let left_px = x_mm * scale;
                        let top_px = y_mm * scale;
                        let width_px = w_mm * scale;
                        let height_px = h_mm * scale;
                        
                        let el = document.createElement("div");
                        el.style.position = "absolute";
                        el.style.left = left_px + "px";
                        el.style.top = top_px + "px";
                        el.style.width = width_px + "px";
                        el.style.height = height_px + "px";
                        el.style.backgroundColor = "#000";
                        
                        container.appendChild(el);
                    }
                } else if (line.startsWith("BARCODE")) {
                    // Format: BARCODE x,y,"code_type",height,human,rotation,narrow,wide,"content"
                    let match = line.match(/BARCODE\s+(\d+)\s*,\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]*)"/);
                    if (match) {
                        let x_mm = parseFloat(match[1]) / 8;
                        let y_mm = parseFloat(match[2]) / 8;
                        let height_mm = parseFloat(match[4]) / 8;
                        
                        let left_px = x_mm * scale;
                        let top_px = y_mm * scale;
                        let barcode_height_px = height_mm * scale;
                        let barcode_type = match[3];
                        let text = match[9];
                        let show_human = parseInt(match[5]) === 1;
                        
                        let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                        svg.style.position = "absolute";
                        svg.style.left = left_px + "px";
                        svg.style.top = top_px + "px";
                        container.appendChild(svg);
                        
                        try {
                            if (text && text.trim() !== "") {
                                JsBarcode(svg, text, {
                                    format: barcode_type === "128" ? "CODE128" : "CODE39",
                                    height: barcode_height_px,
                                    width: 1.2,
                                    displayValue: show_human,
                                    margin: 0,
                                    fontSize: 10,
                                    font: "monospace"
                                });
                            } else {
                                // Show placeholder
                                svg.innerHTML = `<rect width="100" height="${barcode_height_px}" fill="#eee" stroke="#ccc"></rect>
                                                 <text x="10" y="${barcode_height_px/2 + 3}" font-family="monospace" font-size="9" fill="#999">[No Barcode Value]</text>`;
                            }
                        } catch (e) {
                            console.error("Barcode rendering error:", e);
                        }
                    }
                }
            });
        });
    }
};

window.TSCPrinter = TSCPrinter;
