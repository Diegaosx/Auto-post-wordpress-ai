<?php
/**
 * Plugin Name: Auto Post WordPress AI
 * Plugin URI: https://github.com/Diegaosx/Auto-post-wordpress-ai
 * Description: Sincronização automatizada e publicação de artigos com Inteligência Artificial via REST API segura.
 * Version: 1.1.0
 * Author: Auto Post AI Team
 * License: GPL v2 or later
 * Text Domain: auto-post-wordpress-ai
 */

if (!defined('ABSPATH')) {
    exit;
}

define('AUTO_POST_AI_VERSION', '1.1.0');
define('AUTO_POST_AI_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('AUTO_POST_AI_PLUGIN_URL', plugin_dir_url(__FILE__));
define('AUTO_POST_AI_DEFAULT_API_URL', '{{API_URL}}');

class AutoPostWordPressAI {

    private $api_key;
    private $api_url;

    public function __construct() {
        add_action('init', array($this, 'init'));
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_action('rest_api_init', array($this, 'register_rest_routes'));
        add_action('wp_ajax_autopost_test_connection', array($this, 'ajax_test_connection'));
        register_activation_hook(__FILE__, array($this, 'activate'));
        register_deactivation_hook(__FILE__, array($this, 'deactivate'));
    }

    public function init() {
        $this->api_key = get_option('autopost_ai_api_key', '');
        $this->api_url = get_option('autopost_ai_api_url', '');

        $default_constant = defined('AUTO_POST_AI_DEFAULT_API_URL') && AUTO_POST_AI_DEFAULT_API_URL !== '{{API_URL}}'
            ? AUTO_POST_AI_DEFAULT_API_URL
            : '';

        if (!empty($default_constant)) {
            $this->api_url = $default_constant;
            if (get_option('autopost_ai_api_url') !== $default_constant) {
                update_option('autopost_ai_api_url', $default_constant);
            }
        } elseif (empty($this->api_url) || $this->api_url === '{{API_URL}}' || $this->api_url === 'http://localhost:3000') {
            $this->api_url = 'https://auto-post-wordpress-ai-production.up.railway.app';
            update_option('autopost_ai_api_url', $this->api_url);
        }
    }

    public function activate() {
        add_option('autopost_ai_api_key', '');
        $default = defined('AUTO_POST_AI_DEFAULT_API_URL') && AUTO_POST_AI_DEFAULT_API_URL !== '{{API_URL}}'
            ? AUTO_POST_AI_DEFAULT_API_URL
            : 'https://auto-post-wordpress-ai-production.up.railway.app';
        update_option('autopost_ai_api_url', $default);
        add_option('autopost_ai_status', 'disconnected');
        add_option('autopost_ai_last_sync', 'Nunca');
        flush_rewrite_rules();
    }

    public function deactivate() {
        flush_rewrite_rules();
    }

    public function add_admin_menu() {
        add_menu_page(
            'Auto Post AI',
            'Auto Post AI',
            'manage_options',
            'auto-post-ai',
            array($this, 'render_admin_page'),
            'dashicons-superhero',
            65
        );
    }

    public function render_admin_page() {
        if (isset($_POST['autopost_save_settings']) && check_admin_referer('autopost_save_nonce', 'autopost_nonce_field')) {
            $new_key = sanitize_text_field($_POST['api_key'] ?? '');
            if (!empty($new_key)) {
                update_option('autopost_ai_api_key', $new_key);
                $this->api_key = $new_key;
            }

            $target_url = defined('AUTO_POST_AI_DEFAULT_API_URL') && AUTO_POST_AI_DEFAULT_API_URL !== '{{API_URL}}'
                ? AUTO_POST_AI_DEFAULT_API_URL
                : (!empty($_POST['api_url']) ? esc_url_raw(rtrim($_POST['api_url'], '/')) : 'https://auto-post-wordpress-ai-production.up.railway.app');

            update_option('autopost_ai_api_url', $target_url);
            $this->api_url = $target_url;

            echo '<div class="notice notice-success is-dismissible"><p>Configurações salvas com sucesso!</p></div>';
            $this->verify_license_connection();
        }

        $default_constant = defined('AUTO_POST_AI_DEFAULT_API_URL') && AUTO_POST_AI_DEFAULT_API_URL !== '{{API_URL}}'
            ? AUTO_POST_AI_DEFAULT_API_URL
            : '';

        $api_key = get_option('autopost_ai_api_key', '');
        $api_url = !empty($default_constant) ? $default_constant : get_option('autopost_ai_api_url', 'https://auto-post-wordpress-ai-production.up.railway.app');
        $status = get_option('autopost_ai_status', 'disconnected');
        $last_sync = get_option('autopost_ai_last_sync', 'Nunca');
        ?>
        <div class="wrap" style="max-width: 900px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 20px; margin-bottom: 20px; background: #0f172a; color: #fff; padding: 24px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                <div>
                    <h1 style="color: #38bdf8; margin: 0; font-size: 24px; font-weight: 700; display: flex; align-items: center; gap: 10px;">
                        ⚡ Auto Post WordPress AI
                    </h1>
                    <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 14px;">
                        Módulo de recepção e sincronização de artigos inteligentes.
                    </p>
                </div>
                <div>
                    <?php if ($status === 'connected'): ?>
                        <span style="background: #166534; color: #4ade80; padding: 6px 14px; border-radius: 9999px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
                            ● Conectado
                        </span>
                    <?php elseif ($status === 'pending'): ?>
                        <span style="background: #854d0e; color: #fef08a; padding: 6px 14px; border-radius: 9999px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
                            ● Aguardando Validação
                        </span>
                    <?php else: ?>
                        <span style="background: #991b1b; color: #fca5a5; padding: 6px 14px; border-radius: 9999px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
                            ● Desconectado
                        </span>
                    <?php endif; ?>
                </div>
            </div>

            <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); margin-bottom: 24px;">
                <h2 style="font-size: 18px; font-weight: 600; color: #1e293b; margin-top: 0; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
                    Chave de Licença e Conexão da API
                </h2>

                <form method="post" action="">
                    <?php wp_nonce_field('autopost_save_nonce', 'autopost_nonce_field'); ?>
                    <table class="form-table" role="presentation">
                        <tr>
                            <th scope="row" style="width: 220px;">
                                <label for="api_key" style="font-weight: 600; color: #334155;">Chave de Licença (API Key)</label>
                            </th>
                            <td>
                                <input 
                                    name="api_key" 
                                    type="password" 
                                    id="api_key" 
                                    value="<?php echo esc_attr($api_key); ?>" 
                                    class="regular-text" 
                                    style="width: 100%; max-width: 500px; font-family: monospace; font-size: 14px; padding: 8px 12px; border-radius: 6px;"
                                    placeholder="Ex: APAI-XXXX-XXXX-XXXX"
                                    required
                                />
                                <p class="description" style="color: #64748b; margin-top: 6px;">
                                    Obtenha sua chave no painel do Auto Post AI na aba <strong>Sites WordPress</strong>.
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">
                                <label style="font-weight: 600; color: #334155;">URL do Painel / Servidor</label>
                            </th>
                            <td>
                                <div style="display: inline-flex; align-items: center; gap: 10px; background: #f8fafc; padding: 8px 14px; border-radius: 6px; border: 1px solid #cbd5e1; min-width: 380px; max-width: 500px;">
                                    <span style="font-size: 15px;">🔒</span>
                                    <code style="font-size: 13px; color: #0f172a; font-weight: 600; background: transparent; padding: 0; word-break: break-all;"><?php echo esc_html($api_url); ?></code>
                                    <span style="margin-left: auto; background: #dcfce7; color: #15803d; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; white-space: nowrap;">
                                        ✓ Identificado via APP_URL
                                    </span>
                                </div>
                                <input type="hidden" name="api_url" id="api_url" value="<?php echo esc_attr($api_url); ?>" />
                                <p class="description" style="color: #64748b; margin-top: 6px;">
                                    Identificado e configurado automaticamente pelo pacote do plugin. Você não precisa alterar nem informar este campo.
                                </p>
                            </td>
                        </tr>
                    </table>

                    <div style="margin-top: 24px; display: flex; align-items: center; gap: 12px;">
                        <input type="submit" name="autopost_save_settings" class="button button-primary" value="Salvar Configurações" style="padding: 6px 20px; font-size: 14px; height: auto;" />
                        <button type="button" id="btn-test-connection" class="button button-secondary" style="padding: 6px 18px; font-size: 14px; height: auto;">
                            Testar Conexão Agora
                        </button>
                        <span id="test-connection-spinner" class="spinner" style="float: none; margin: 0;"></span>
                    </div>
                </form>

                <div id="test-result-box" style="margin-top: 16px; display: none;"></div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px;">
                    <h3 style="margin-top: 0; color: #334155; font-size: 15px; font-weight: 600;">Status da Instalação</h3>
                    <ul style="margin: 0; padding: 0; list-style: none; font-size: 13px; color: #475569; line-height: 2;">
                        <li><strong>Versão do Plugin:</strong> <?php echo AUTO_POST_AI_VERSION; ?></li>
                        <li><strong>URL do Site:</strong> <code><?php echo esc_html(get_site_url()); ?></code></li>
                        <li><strong>Última Sincronização:</strong> <?php echo esc_html($last_sync); ?></li>
                        <li><strong>REST API Endpoint:</strong> <code>/wp-json/autopost-ai/v1/posts</code></li>
                    </ul>
                </div>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px;">
                    <h3 style="margin-top: 0; color: #334155; font-size: 15px; font-weight: 600;">Recursos Compatíveis</h3>
                    <ul style="margin: 0; padding: 0; list-style: none; font-size: 13px; color: #475569; line-height: 2;">
                        <li>✅ Publicação Direta e Rascunho</li>
                        <li>✅ Download e Destaque de Imagem Automático</li>
                        <li>✅ Criação Dinâmica de Tags e Categorias</li>
                        <li>✅ Meta Tags SEO (Yoast, RankMath, All In One)</li>
                    </ul>
                </div>
            </div>
        </div>

        <script>
        jQuery(document).ready(function($) {
            $('#btn-test-connection').on('click', function(e) {
                e.preventDefault();
                var btn = $(this);
                var spinner = $('#test-connection-spinner');
                var resultBox = $('#test-result-box');

                btn.prop('disabled', true);
                spinner.addClass('is-active');
                resultBox.hide();

                $.post(ajaxurl, {
                    action: 'autopost_test_connection',
                    _ajax_nonce: '<?php echo wp_create_nonce('autopost_test_nonce'); ?>'
                }, function(response) {
                    if (response.success) {
                        resultBox.html('<div class="notice notice-success inline" style="margin: 0; padding: 12px;"><p><strong>✅ Sucesso:</strong> ' + response.data.message + '</p></div>').fadeIn();
                        setTimeout(function() { location.reload(); }, 1200);
                    } else {
                        resultBox.html('<div class="notice notice-error inline" style="margin: 0; padding: 12px;"><p><strong>❌ Erro:</strong> ' + (response.data ? response.data.message : 'Falha na conexão com o servidor') + '</p></div>').fadeIn();
                    }
                }).fail(function() {
                    resultBox.html('<div class="notice notice-error inline" style="margin: 0; padding: 12px;"><p><strong>❌ Falha na requisição Ajax.</strong></p></div>').fadeIn();
                }).always(function() {
                    btn.prop('disabled', false);
                    spinner.removeClass('is-active');
                });
            });
        });
        </script>
        <?php
    }

    public function ajax_test_connection() {
        check_ajax_referer('autopost_test_nonce');
        $success = $this->verify_license_connection();

        if ($success) {
            wp_send_json_success(array('message' => 'Site validado e conectado com sucesso ao painel Auto Post AI!'));
        } else {
            wp_send_json_error(array('message' => 'Não foi possível validar a chave de licença no painel. Verifique se a chave digitada está correta no painel.'));
        }
    }

    public function verify_license_connection() {
        $api_key = get_option('autopost_ai_api_key', '');
        $api_url = get_option('autopost_ai_api_url', '');

        $default_constant = defined('AUTO_POST_AI_DEFAULT_API_URL') && AUTO_POST_AI_DEFAULT_API_URL !== '{{API_URL}}'
            ? AUTO_POST_AI_DEFAULT_API_URL
            : '';

        if (!empty($default_constant)) {
            $api_url = $default_constant;
            update_option('autopost_ai_api_url', $api_url);
        } elseif (empty($api_url) || $api_url === '{{API_URL}}' || $api_url === 'http://localhost:3000') {
            $api_url = 'https://auto-post-wordpress-ai-production.up.railway.app';
            update_option('autopost_ai_api_url', $api_url);
        }

        if (empty($api_key) || empty($api_url)) {
            update_option('autopost_ai_status', 'disconnected');
            return false;
        }

        $endpoint = rtrim($api_url, '/') . '/api/wordpress/verify';
        $payload = array(
            'api_key' => $api_key,
            'site_url' => get_site_url(),
            'site_name' => get_bloginfo('name'),
            'version' => AUTO_POST_AI_VERSION,
        );

        $response = wp_remote_post($endpoint, array(
            'headers' => array('Content-Type' => 'application/json'),
            'body' => json_encode($payload),
            'timeout' => 15,
            'sslverify' => false,
        ));

        if (is_wp_error($response)) {
            error_log('AutoPost AI Error: ' . $response->get_error_message());
            update_option('autopost_ai_status', 'error');
            return false;
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if ($code >= 200 && $code < 300 && !empty($data['success'])) {
            update_option('autopost_ai_status', 'connected');
            update_option('autopost_ai_last_sync', current_time('mysql'));
            return true;
        }

        update_option('autopost_ai_status', 'error');
        return false;
    }

    public function register_rest_routes() {
        $namespace = 'autopost-ai/v1';

        // 1. Status
        register_rest_route($namespace, '/status', array(
            'methods' => 'GET',
            'callback' => array($this, 'rest_get_status'),
            'permission_callback' => '__return_true',
        ));

        // 2. Posts (Listar / Criar)
        register_rest_route($namespace, '/posts', array(
            array(
                'methods' => 'GET',
                'callback' => array($this, 'rest_get_posts'),
                'permission_callback' => array($this, 'rest_verify_auth'),
            ),
            array(
                'methods' => 'POST',
                'callback' => array($this, 'rest_create_post'),
                'permission_callback' => array($this, 'rest_verify_auth'),
            ),
        ));

        // 3. Posts por ID (Atualizar)
        register_rest_route($namespace, '/posts/(?P<id>\d+)', array(
            'methods' => 'POST',
            'callback' => array($this, 'rest_update_post'),
            'permission_callback' => array($this, 'rest_verify_auth'),
            'args' => array(
                'id' => array(
                    'validate_callback' => function($param) {
                        return is_numeric($param);
                    }
                )
            )
        ));

        // 4. Categorias e Tags
        register_rest_route($namespace, '/categories', array(
            'methods' => 'GET',
            'callback' => array($this, 'rest_get_categories'),
            'permission_callback' => array($this, 'rest_verify_auth'),
        ));
        register_rest_route($namespace, '/tags', array(
            'methods' => 'GET',
            'callback' => array($this, 'rest_get_tags'),
            'permission_callback' => array($this, 'rest_verify_auth'),
        ));

        // 5. Mídia direta
        register_rest_route($namespace, '/media', array(
            'methods' => 'POST',
            'callback' => array($this, 'rest_upload_media'),
            'permission_callback' => array($this, 'rest_verify_auth'),
        ));
    }

    public function rest_verify_auth($request) {
        $saved_key = get_option('autopost_ai_api_key', '');
        if (empty($saved_key)) {
            return new WP_Error('rest_forbidden', 'Plugin ainda não possui Chave de Licença configurada.', array('status' => 403));
        }

        $provided_key = $request->get_header('x-api-key');
        if (empty($provided_key)) {
            $auth = $request->get_header('authorization');
            if ($auth && preg_match('/Bearer\s+(.*)$/i', $auth, $matches)) {
                $provided_key = $matches[1];
            }
        }

        if (empty($provided_key) || !hash_equals($saved_key, $provided_key)) {
            return new WP_Error('rest_forbidden', 'Chave de Licença (X-API-Key) inválida ou não autorizada.', array('status' => 401));
        }

        return true;
    }

    public function rest_get_status() {
        return array(
            'plugin' => 'Auto Post WordPress AI',
            'version' => AUTO_POST_AI_VERSION,
            'status' => get_option('autopost_ai_status', 'disconnected'),
            'site_url' => get_site_url(),
            'site_name' => get_bloginfo('name'),
            'last_sync' => get_option('autopost_ai_last_sync', 'Nunca'),
        );
    }

    public function rest_get_posts($request) {
        $per_page = intval($request->get_param('per_page') ?: 10);
        $status = sanitize_text_field($request->get_param('status') ?: 'any');

        $args = array(
            'numberposts' => min($per_page, 50),
            'post_type' => 'post',
            'orderby' => 'date',
            'order' => 'DESC',
            'post_status' => $status === 'any' ? array('publish', 'draft', 'pending') : $status,
        );

        $posts = get_posts($args);
        $result = array();

        foreach ($posts as $p) {
            $thumbnail = get_the_post_thumbnail_url($p->ID, 'full');
            $result[] = array(
                'id' => $p->ID,
                'title' => $p->post_title,
                'excerpt' => $p->post_excerpt,
                'status' => $p->post_status,
                'date' => $p->post_date,
                'permalink' => get_permalink($p->ID),
                'featured_image' => $thumbnail ?: null,
            );
        }

        return rest_ensure_response(array('success' => true, 'data' => $result));
    }

    public function rest_create_post($request) {
        $body = $request->get_json_params();

        $title = sanitize_text_field($body['title'] ?? '');
        $content = wp_kses_post($body['content'] ?? '');
        $excerpt = sanitize_text_field($body['excerpt'] ?? '');
        $status = in_array($body['status'] ?? '', array('publish', 'draft', 'pending')) ? $body['status'] : 'draft';
        $category_names = $body['categories'] ?? array();
        $tag_names = $body['tags'] ?? array();
        $image_url = esc_url_raw($body['image_url'] ?? $body['featured_image'] ?? '');
        $meta_data = $body['meta'] ?? array();

        if (empty($title) || empty($content)) {
            return new WP_Error('invalid_payload', 'Título e Conteúdo são campos obrigatórios.', array('status' => 400));
        }

        // Mapear ou criar categorias
        $cat_ids = array();
        if (!empty($category_names)) {
            if (!is_array($category_names)) {
                $category_names = array($category_names);
            }
            foreach ($category_names as $cname) {
                $term = term_exists($cname, 'category');
                if ($term) {
                    $cat_ids[] = (int) (is_array($term) ? $term['term_id'] : $term);
                } else {
                    $created = wp_create_category($cname);
                    if ($created && !is_wp_error($created)) {
                        $cat_ids[] = (int) $created;
                    }
                }
            }
        }

        $post_arr = array(
            'post_title' => $title,
            'post_content' => $content,
            'post_excerpt' => $excerpt,
            'post_status' => $status,
            'post_type' => 'post',
            'post_category' => $cat_ids,
            'tags_input' => $tag_names,
        );

        $post_id = wp_insert_post($post_arr, true);

        if (is_wp_error($post_id)) {
            return new WP_Error('post_insert_failed', $post_id->get_error_message(), array('status' => 500));
        }

        // Salvar referência da origem
        update_post_meta($post_id, '_autopost_ai_generated', '1');
        update_post_meta($post_id, '_autopost_ai_sync_date', current_time('mysql'));
        if (!empty($body['source_url'])) {
            update_post_meta($post_id, '_autopost_ai_source_url', esc_url_raw($body['source_url']));
        }

        // Metadados SEO Avançados (Yoast, RankMath, AIOSEO)
        $this->apply_post_seo_metadata($post_id, $body);

        // Processar Imagem em Destaque (Base64 / URL Resiliente / Attachment ID) + SEO da Imagem
        $featured_thumb_id = $this->process_featured_image($post_id, $body);

        update_option('autopost_ai_last_sync', current_time('mysql'));

        return rest_ensure_response(array(
            'success'            => true,
            'post_id'            => $post_id,
            'status'             => $status,
            'permalink'          => get_permalink($post_id),
            'featured_image_id'  => $featured_thumb_id,
            'featured_image_url' => $featured_thumb_id ? wp_get_attachment_url($featured_thumb_id) : null,
        ));
    }

    public function rest_update_post($request) {
        $post_id = intval($request->get_param('id'));
        $body = $request->get_json_params();

        if (!$post_id || !get_post($post_id)) {
            return new WP_Error('not_found', 'Post não encontrado', array('status' => 404));
        }

        $update_arr = array('ID' => $post_id);
        if (!empty($body['title'])) $update_arr['post_title'] = sanitize_text_field($body['title']);
        if (!empty($body['content'])) $update_arr['post_content'] = wp_kses_post($body['content']);
        if (!empty($body['status'])) $update_arr['post_status'] = sanitize_text_field($body['status']);

        $res = wp_update_post($update_arr, true);
        if (is_wp_error($res)) {
            return new WP_Error('update_failed', $res->get_error_message(), array('status' => 500));
        }

        // Atualizar SEO do post
        $this->apply_post_seo_metadata($post_id, $body);

        // Atualizar imagem em destaque se fornecida
        $featured_thumb_id = null;
        if (!empty($body['image_base64']) || !empty($body['image_url']) || !empty($body['featured_image']) || !empty($body['featured_media'])) {
            $featured_thumb_id = $this->process_featured_image($post_id, $body);
        }

        return rest_ensure_response(array(
            'success'            => true,
            'post_id'            => $post_id,
            'permalink'          => get_permalink($post_id),
            'featured_image_id'  => $featured_thumb_id,
            'featured_image_url' => $featured_thumb_id ? wp_get_attachment_url($featured_thumb_id) : null,
        ));
    }

    public function rest_get_categories() {
        $cats = get_categories(array('hide_empty' => false));
        $res = array();
        foreach ($cats as $c) {
            $res[] = array(
                'id' => $c->term_id,
                'name' => $c->name,
                'slug' => $c->slug,
                'count' => $c->count,
            );
        }
        return rest_ensure_response(array('success' => true, 'data' => $res));
    }

    public function rest_get_tags() {
        $tags = get_tags(array('hide_empty' => false));
        $res = array();
        foreach ($tags as $t) {
            $res[] = array(
                'id' => $t->term_id,
                'name' => $t->name,
                'slug' => $t->slug,
            );
        }
        return rest_ensure_response(array('success' => true, 'data' => $res));
    }

    public function rest_upload_media($request) {
        $body = $request->get_json_params();
        $image_url = esc_url_raw($body['image_url'] ?? '');
        $image_base64 = $body['image_base64'] ?? '';
        $title = sanitize_text_field($body['title'] ?? 'Imagem Auto Post AI');
        $alt_text = sanitize_text_field($body['alt_text'] ?? $body['image_alt'] ?? $title);

        $attach_id = null;
        if (!empty($image_base64)) {
            $attach_id = $this->upload_base64_image($image_base64, 0, $title, $alt_text);
        } elseif (!empty($image_url)) {
            $attach_id = $this->upload_external_image_resilient($image_url, 0, $title, $alt_text);
        }

        if ($attach_id && !is_wp_error($attach_id)) {
            return rest_ensure_response(array(
                'success' => true,
                'id'      => $attach_id,
                'url'     => wp_get_attachment_url($attach_id),
            ));
        }

        return new WP_Error('upload_failed', 'Não foi possível baixar ou salvar a imagem', array('status' => 500));
    }

    /**
     * Aplica metadados avançados de SEO ao post (compatível com Yoast SEO, Rank Math, AIOSEO)
     */
    private function apply_post_seo_metadata($post_id, $body) {
        $title = sanitize_text_field($body['seo_title'] ?? $body['title'] ?? '');
        $desc = sanitize_text_field($body['seo_description'] ?? $body['excerpt'] ?? '');
        $focus_kw = sanitize_text_field($body['focus_keyword'] ?? ($body['tags'][0] ?? ''));
        $keywords = $body['keywords'] ?? $body['tags'] ?? array();

        // Yoast SEO
        if (!empty($title)) {
            update_post_meta($post_id, '_yoast_wpseo_title', $title);
            update_post_meta($post_id, 'rank_math_title', $title);
        }
        if (!empty($desc)) {
            update_post_meta($post_id, '_yoast_wpseo_metadesc', $desc);
            update_post_meta($post_id, 'rank_math_description', $desc);
        }
        if (!empty($focus_kw)) {
            update_post_meta($post_id, '_yoast_wpseo_focuskw', $focus_kw);
            update_post_meta($post_id, 'rank_math_focus_keyword', $focus_kw);
        }
        if (!empty($keywords) && is_array($keywords)) {
            $clean_kw = array_map('sanitize_text_field', $keywords);
            update_post_meta($post_id, '_yoast_wpseo_keywordsynonyms', wp_json_encode($clean_kw));
        }

        // Meta tags livres enviadas no payload
        if (!empty($body['meta']) && is_array($body['meta'])) {
            foreach ($body['meta'] as $meta_key => $meta_val) {
                if (is_scalar($meta_val)) {
                    update_post_meta($post_id, sanitize_key($meta_key), sanitize_text_field($meta_val));
                }
            }
        }
    }

    /**
     * Processa imagem destacada (por base64, ID direto ou download resiliente) e aplica SEO
     */
    public function process_featured_image($post_id, $params) {
        $title = sanitize_text_field($params['title'] ?? get_the_title($post_id));
        $alt_text = sanitize_text_field($params['image_alt'] ?? $params['alt_text'] ?? $title);
        $caption = sanitize_text_field($params['image_caption'] ?? $params['caption'] ?? '');
        $description = sanitize_text_field($params['image_description'] ?? $params['description'] ?? '');
        $image_url = esc_url_raw($params['image_url'] ?? $params['featured_image'] ?? '');
        $image_base64 = $params['image_base64'] ?? '';
        $featured_media = intval($params['featured_media'] ?? 0);

        // Se já recebeu um ID direto de attachment existente
        if ($featured_media > 0 && get_post($featured_media)) {
            set_post_thumbnail($post_id, $featured_media);
            update_post_meta($post_id, '_thumbnail_id', $featured_media);
            $this->apply_seo_image_tags($post_id, $featured_media, $params);
            return $featured_media;
        }

        $attachment_id = null;

        // 1. Tentar upload direto de imagem base64 (100% infalível, dispensa requisição externa do PHP)
        if (!empty($image_base64)) {
            $res = $this->upload_base64_image($image_base64, $post_id, $title, $alt_text, $caption, $description);
            if (!is_wp_error($res) && is_numeric($res)) {
                $attachment_id = (int) $res;
            }
        }

        // 2. Se não veio base64 ou falhou, tentar download resiliente da URL externa
        if (!$attachment_id && !empty($image_url)) {
            $attachment_id = $this->upload_external_image_resilient($image_url, $post_id, $title, $alt_text, $caption, $description);
        }

        if ($attachment_id && is_numeric($attachment_id)) {
            set_post_thumbnail($post_id, $attachment_id);
            update_post_meta($post_id, '_thumbnail_id', $attachment_id);
            $this->apply_seo_image_tags($post_id, $attachment_id, $params);
            return $attachment_id;
        }

        return null;
    }

    /**
     * Faz upload de imagem base64 para o WordPress com nome SEO e alt text
     */
    private function upload_base64_image($base64_data, $post_id, $title = '', $alt_text = '', $caption = '', $description = '') {
        if (preg_match('/data:image\/(\w+);base64,(.+)/s', $base64_data, $matches)) {
            $image_type = strtolower($matches[1]);
            $image_data = base64_decode($matches[2]);
        } else {
            // Tenta decodificar string base64 pura
            $image_data = base64_decode($base64_data);
            $image_type = 'jpg';
        }

        if (!$image_data) {
            return new WP_Error('decode_failed', 'Falha ao decodificar imagem base64');
        }

        if ($image_type === 'jpeg') $image_type = 'jpg';
        if (!in_array($image_type, array('jpg', 'png', 'webp', 'gif'))) {
            $image_type = 'jpg';
        }

        // Gerar nome de arquivo otimizado para SEO com base no título
        $slug = sanitize_title($title ?: 'imagem-destaque-' . $post_id);
        $filename = ($slug ? substr($slug, 0, 60) : 'foto-' . $post_id) . '-' . time() . '.' . $image_type;

        $upload = wp_upload_bits($filename, null, $image_data);
        if (!empty($upload['error'])) {
            return new WP_Error('upload_failed', $upload['error']);
        }

        $attachment = array(
            'post_mime_type' => 'image/' . ($image_type === 'jpg' ? 'jpeg' : $image_type),
            'post_title'     => $title ?: sanitize_file_name(pathinfo($filename, PATHINFO_FILENAME)),
            'post_content'   => $description,
            'post_excerpt'   => $caption,
            'post_status'    => 'inherit'
        );

        $attachment_id = wp_insert_attachment($attachment, $upload['file'], $post_id);
        if (is_wp_error($attachment_id)) {
            return $attachment_id;
        }

        require_once(ABSPATH . 'wp-admin/includes/image.php');
        require_once(ABSPATH . 'wp-admin/includes/media.php');

        $attach_data = wp_generate_attachment_metadata($attachment_id, $upload['file']);
        wp_update_attachment_metadata($attachment_id, $attach_data);

        // Definir texto alternativo SEO
        if (!empty($alt_text)) {
            update_post_meta($attachment_id, '_wp_attachment_image_alt', $alt_text);
        }

        return $attachment_id;
    }

    /**
     * Download resiliente de imagem externa (contorna bloqueios de CDN, User-Agent e SSL)
     */
    private function upload_external_image_resilient($image_url, $post_id, $title = '', $alt_text = '', $caption = '', $description = '') {
        $user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

        require_once(ABSPATH . 'wp-admin/includes/file.php');
        require_once(ABSPATH . 'wp-admin/includes/media.php');
        require_once(ABSPATH . 'wp-admin/includes/image.php');

        $tmp = wp_tempnam($image_url);
        if (!$tmp) {
            $tmp = tempnam(get_temp_dir(), 'wppic');
        }

        $downloaded = false;

        // 1. Tentar wp_remote_get com streaming e Browser User-Agent
        $response = wp_remote_get($image_url, array(
            'timeout'     => 25,
            'user-agent'  => $user_agent,
            'headers'     => array(
                'Accept'  => 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Referer' => $image_url,
            ),
            'sslverify'   => false,
            'stream'      => true,
            'filename'    => $tmp,
        ));

        if (!is_wp_error($response) && wp_remote_retrieve_response_code($response) === 200 && file_exists($tmp) && filesize($tmp) > 0) {
            $downloaded = true;
        }

        // 2. Se falhar, tentar cURL nativo com impersonação de navegador
        if (!$downloaded && function_exists('curl_init')) {
            $ch = curl_init($image_url);
            $fp = @fopen($tmp, 'wb');
            if ($fp) {
                curl_setopt($ch, CURLOPT_FILE, $fp);
                curl_setopt($ch, CURLOPT_HEADER, 0);
                curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
                curl_setopt($ch, CURLOPT_TIMEOUT, 30);
                curl_setopt($ch, CURLOPT_USERAGENT, $user_agent);
                curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
                curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
                curl_exec($ch);
                $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);
                fclose($fp);
                if ($code === 200 && file_exists($tmp) && filesize($tmp) > 0) {
                    $downloaded = true;
                }
            }
        }

        // 3. Fallback clássico do WordPress
        if (!$downloaded) {
            $fallback_tmp = download_url($image_url, 30);
            if (!is_wp_error($fallback_tmp) && file_exists($fallback_tmp) && filesize($fallback_tmp) > 0) {
                @copy($fallback_tmp, $tmp);
                @unlink($fallback_tmp);
                $downloaded = true;
            }
        }

        if (!$downloaded || !file_exists($tmp) || filesize($tmp) === 0) {
            @unlink($tmp);
            return null;
        }

        // Detectar extensão e MIME real da imagem
        $file_info = @getimagesize($tmp);
        $ext = 'jpg';
        if ($file_info && isset($file_info['mime'])) {
            if (strpos($file_info['mime'], 'png') !== false) $ext = 'png';
            elseif (strpos($file_info['mime'], 'webp') !== false) $ext = 'webp';
            elseif (strpos($file_info['mime'], 'gif') !== false) $ext = 'gif';
        }

        // Gerar nome do arquivo amigável para SEO
        $slug = sanitize_title($title ?: 'destaque');
        $filename = ($slug ? substr($slug, 0, 60) : 'foto-' . $post_id) . '-' . time() . '.' . $ext;

        $file_array = array(
            'name'     => $filename,
            'tmp_name' => $tmp,
        );

        $attachment_id = media_handle_sideload($file_array, $post_id, $title);
        if (is_wp_error($attachment_id)) {
            @unlink($tmp);
            return null;
        }

        // Metadados SEO do attachment
        wp_update_post(array(
            'ID'           => $attachment_id,
            'post_title'   => $title ?: sanitize_file_name(pathinfo($filename, PATHINFO_FILENAME)),
            'post_content' => $description,
            'post_excerpt' => $caption,
        ));

        if (!empty($alt_text)) {
            update_post_meta($attachment_id, '_wp_attachment_image_alt', $alt_text);
        }

        return $attachment_id;
    }

    /**
     * Aplica tags sociais de imagem para plugins de SEO (Yoast, Rank Math, AIOSEO)
     */
    private function apply_seo_image_tags($post_id, $attachment_id, $params = array()) {
        $attachment_url = wp_get_attachment_url($attachment_id);
        if (!$attachment_url) return;

        // Yoast SEO
        update_post_meta($post_id, '_yoast_wpseo_opengraph-image', $attachment_url);
        update_post_meta($post_id, '_yoast_wpseo_opengraph-image-id', $attachment_id);
        update_post_meta($post_id, '_yoast_wpseo_twitter-image', $attachment_url);
        update_post_meta($post_id, '_yoast_wpseo_twitter-image-id', $attachment_id);

        // Rank Math SEO
        update_post_meta($post_id, 'rank_math_facebook_image', $attachment_url);
        update_post_meta($post_id, 'rank_math_facebook_image_id', $attachment_id);
        update_post_meta($post_id, 'rank_math_twitter_image', $attachment_url);
        update_post_meta($post_id, 'rank_math_twitter_image_id', $attachment_id);

        // All in One SEO
        update_post_meta($post_id, '_aioseo_og_image_type', 'featured');
        update_post_meta($post_id, '_aioseo_og_image_custom_url', $attachment_url);
        update_post_meta($post_id, '_aioseo_twitter_image_type', 'featured');
        update_post_meta($post_id, '_aioseo_twitter_image_custom_url', $attachment_url);
    }

    private function sideload_featured_image($image_url, $post_id, $desc = '') {
        return $this->process_featured_image($post_id, array(
            'image_url' => $image_url,
            'title'     => $desc,
        ));
    }
}

new AutoPostWordPressAI();
