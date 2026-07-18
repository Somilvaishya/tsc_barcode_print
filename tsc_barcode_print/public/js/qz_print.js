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

            // Substitute context in raw code
            let raw_code = template_doc.raw_tspl || "";
            for (let key in context) {
                let val = context[key] !== undefined && context[key] !== null ? context[key] : "";
                let regex = new RegExp("{{\\s*" + key + "\\s*}}", "g");
                raw_code = raw_code.replace(regex, val);
            }
            
            let language = template_doc.printer_language || "TSPL";
            
            if (language === "ZPL") {
                this._renderZPL(container, raw_code, width_mm, height_mm);
            } else if (language === "EPL") {
                this._renderEPL(container, raw_code, scale);
            } else {
                this._renderTSPL(container, raw_code, scale);
            }
        });
    },

    _renderZPL: function(container, zpl, width_mm, height_mm) {
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:12px;">Loading ZPL from Labelary...</div>';
        
        let width_inch = (width_mm / 25.4).toFixed(2);
        let height_inch = (height_mm / 25.4).toFixed(2);
        let url = `http://api.labelary.com/v1/printers/8dpmm/labels/${width_inch}x${height_inch}/0/`;
        
        fetch(url, {
            method: 'POST',
            body: zpl,
            headers: { 
                'Accept': 'image/png',
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })
        .then(response => {
            if (!response.ok) throw new Error("Labelary API error");
            return response.blob();
        })
        .then(blob => {
            let img_url = URL.createObjectURL(blob);
            container.innerHTML = `<img src="${img_url}" style="width:100%;height:100%;object-fit:contain;" />`;
        })
        .catch(err => {
            console.error(err);
            container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:red;font-size:12px;text-align:center;">Failed to render ZPL.<br>Check internet connection.</div>';
        });
    },

    _renderEPL: function(container, epl, scale) {
        let lines = epl.split("\n");
        lines.forEach(line => {
            line = line.trim();
            if (line.startsWith("A")) {
                let match = line.match(/^A(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\w\d]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[N,R,B,W]\s*,\s*"([^"]*)"/i);
                if (match) {
                    let x_px = parseFloat(match[1]) / 8 * scale;
                    let y_px = parseFloat(match[2]) / 8 * scale;
                    let text = match[7];
                    
                    let el = document.createElement("div");
                    el.style.position = "absolute";
                    el.style.left = x_px + "px";
                    el.style.top = y_px + "px";
                    el.style.fontFamily = "monospace";
                    el.style.fontSize = "12px";
                    el.style.fontWeight = "bold";
                    el.style.color = "#000";
                    el.style.lineHeight = "1";
                    el.style.whiteSpace = "nowrap";
                    el.innerText = text;
                    container.appendChild(el);
                }
            } else if (line.startsWith("LO") || line.startsWith("LE")) {
                let match = line.match(/^L[OE](\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
                if (match) {
                    let x_px = parseFloat(match[1]) / 8 * scale;
                    let y_px = parseFloat(match[2]) / 8 * scale;
                    let w_px = parseFloat(match[3]) / 8 * scale;
                    let h_px = parseFloat(match[4]) / 8 * scale;
                    
                    let el = document.createElement("div");
                    el.style.position = "absolute";
                    el.style.left = x_px + "px";
                    el.style.top = y_px + "px";
                    el.style.width = w_px + "px";
                    el.style.height = h_px + "px";
                    el.style.backgroundColor = "#000";
                    container.appendChild(el);
                }
            } else if (line.startsWith("B")) {
                let match = line.match(/^B(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\w\d]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[B,N]\s*,\s*"([^"]*)"/i);
                if (match) {
                    let x_px = parseFloat(match[1]) / 8 * scale;
                    let y_px = parseFloat(match[2]) / 8 * scale;
                    let height_px = parseFloat(match[7]) / 8 * scale;
                    let type = match[4];
                    let text = match[8];
                    
                    let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                    svg.style.position = "absolute";
                    svg.style.left = x_px + "px";
                    svg.style.top = y_px + "px";
                    container.appendChild(svg);
                    
                    try {
                        if (text && text.trim() !== "") {
                            JsBarcode(svg, text, {
                                format: (type === "1" || type.includes("128")) ? "CODE128" : "CODE39",
                                height: height_px,
                                width: 1.2,
                                displayValue: true,
                                margin: 0,
                                fontSize: 10,
                                font: "monospace"
                            });
                        } else {
                            svg.innerHTML = `<rect width="100" height="${height_px}" fill="#eee" stroke="#ccc"></rect>
                                             <text x="10" y="${height_px/2 + 3}" font-family="monospace" font-size="9" fill="#999">[No Barcode]</text>`;
                        }
                    } catch (e) {
                        console.error("Barcode rendering error:", e);
                    }
                }
            }
        });
    },

    _renderTSPL: function(container, lines_text, scale) {
        let lines = lines_text.split("\n");
        lines.forEach(line => {
            line = line.trim();
            if (line.startsWith("TEXT")) {
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
                            svg.innerHTML = `<rect width="100" height="${barcode_height_px}" fill="#eee" stroke="#ccc"></rect>
                                             <text x="10" y="${barcode_height_px/2 + 3}" font-family="monospace" font-size="9" fill="#999">[No Barcode]</text>`;
                        }
                    } catch (e) {
                        console.error("Barcode rendering error:", e);
                    }
                }
            }
        });
    }
};

window.TSCPrinter = TSCPrinter;
